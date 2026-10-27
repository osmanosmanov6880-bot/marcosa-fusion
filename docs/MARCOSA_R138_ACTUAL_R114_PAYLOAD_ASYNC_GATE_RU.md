# MARCOSA R138 — ждать настоящий R114 JSON PASS, а не зелёный wrapper

Дата: 27 октября 2026. Production: **NO-GO**.

## Реальный повторный инцидент на R137

После [PR #155](https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/155)
main `bb849c8251aa498265856cc2408b577c1d5aaa29` успешно выполнил
R48, Pages, STAGING, R114 и R116.

[R136 #40530396880, первая попытка](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40530396880)
отработал проверку готовности всех пяти workflow, но строгий R133 законно отказал:
`R114 needs actual same-SHA Pages/STAGING PASS report`.

Причина: два независимых события workflow_run запускают R114 — после STAGING и после Pages. Ранний R114 может завершить свой workflow успешно, создав **JSON со status=PENDING**, поскольку Pages verify-public-bytes ещё выполняется. Более поздний R114 #40530664073 после завершения Pages создал **JSON PASS** (лог подтверждает `MARCOSA_DUAL_CHANNEL_EVIDENCE=PASS`).

[Повторный запуск того же R136](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40530396880)
после появления PASS-доказательства успешно завершился, создав nonexpired артефакт #12746236367.
Это доказывает, что строгая цепочка работоспособна, но до R138 требовался ручной повтор.

## R138 — реализованная защита

- После R137 `awaitR133Inputs` дополнительно запускается `awaitR114ActualPass`.
- Только **текущий main SHA**, только upstream R114 с `event=workflow_run`, `head_branch=main`, правильным репозиторием.
- Считывает и проверяет metadata артефакта **именно этого GitHub run ID** (имя, неистёкший срок, размер, принадлежность).
- `gh run download` скачивает только разрешённый маленький JSON во временный каталог; каталог удаляется.
- Обязательно `format`, `sourceSha`, `mainSha`, `currentMain=true`, обе ветки Pages/STAGING PASS, доказательства source-backed, все production/clients flag=false.
- `PENDING` не становится успехом, а приводит к ограниченному ожиданию следующего R114 PASS. `FAIL`/`SUPERSEDED`, чужой SHA, чужой run, отключённый продуктовый запрет, изменение main — fail-closed.
- Только после реального JSON PASS запускается прежний строгий R133, который независимо повторно сверяет все пять workflow, jobs и содержимое двух артефактов.
- Сохранён лимит ожидания: максимум 12 попыток по 15 секунд. Отсутствие PASS по истечении лимита — FAIL.
- 12 дополнительных тестов моделируют ошибку R137, успешный поздний R114, ложные PASS и недостоверные отчёты.

## Остаётся неизменным

`marcosa.club`, root-owned production, настоящие Supabase/Postgres/Auth/Storage и клиенты не затронуты. R136/R138 никогда не переключают production. Необходимы ручные R132, R117, два R118, два R121, R122/R127, реальные данные и подпись владельца.

## Приёмка после merge

На **новом main** дождаться проверок R48, Pages, STAGING, R114, R116 и нового R136. Требовать не просто workflow-level success, а job `automatic-readonly-proof=success` + nonexpired `marcosa-r136-current-main-automatic-proof-no-go` с правильным SHA, `productionDecision=NO_GO`.
