# MARCOSA R133 — единый проверяемый автоматический релизный срез

Дата: 26 октября 2026. **Только read-only контроль автоматических доказательств. Production NO-GO.**

## Задача

R48, Pages, STAGING, R114 и R116 подтверждаются независимыми workflow. В прежних этапах стало ясно, что общий `workflow conclusion=success` иногда скрывает `skipped` критического VPS-job, а доказательства предыдущего коммита нельзя переносить на новый main.

R133 собирает единое машинное заключение о пяти автоматизированных стадиях **только для одного действующего SHA**. Новый код не осуществляет SSH, не читает production, не делает запросы к реальной базе пользователей и не меняет DNS или файлы `marcosa.club`.

## Пять обязательных источников

| Стадия | Что R133 проверяет |
| --- | --- |
| R48 | На точном SHA присутствует успешно завершённый `contract-tests` |
| Pages | `verify-and-build`, `publish`, **`verify-public-bytes`** успешно завершены |
| STAGING | `build` и реальный `deploy_ssh_filesystem` завершились |
| R114 | `offline-contract` и `release-evidence` успешны; настоящий, непросроченный JSON-артефакт говорит `status=PASS` и совпадение Pages/STAGING SHA |
| R116 | `offline-rehearsal` и фактический `read-only-vps-proof` успешны; непросроченный артефакт принадлежит **тому же run ID**, имеет точный SHA, подтверждает SSH, SHA-256 rollback candidate и `productionChanged=false` |

Для каждой стадии проверяются конкретное имя workflow, ветка `main`, репозиторий, событие запуска, полный 40-символьный SHA, состояние jobs и требуемые доказательства. Первая неполная страница API, старый SHA, повтор run/artifact ID, `skipped` или `PENDING` приводят к **отказу**, а не к ложному PASS.

R133 выполняет GitHub API только с read-only разрешениями `actions:read` и `contents:read`, загружает только два заранее заданных JSON proof-артефакта R114/R116 и после проверки удаляет временные файлы.

## Запуск

1. Открыть [GitHub Actions](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r133-automatic-proof.yml).
2. После завершения R48, Pages, STAGING, R114 и реального R116 на **одном текущем SHA** выбрать `Run workflow` → `main`.
3. Проверить `offline-contract=success`, затем `actual-main-automatic-proof=success`.
4. Скачать артефакт `marcosa-r133-exact-main-automatic-evidence-no-go`. Он содержит только IDs GitHub Actions и ограниченные результаты проверки, **не** закрытые ключи, IP, HTML, резервные копии базы или персональные данные.

PR выполняет **только локальные offline-тесты**, реальный запуск R133 доступен исключительно через ручной `workflow_dispatch` на `main`. Внешние доказательства предыдущего SHA повторно не используют.

## Когда R133 успешен

В отчёте может быть `status=AUTOMATIC_PREVIEW_AND_READONLY_ROLLBACK_PROOFS_PASS`, но одновременно остаётся **`productionDecision=NO_GO`** и список восьми открытых направлений:

- R132 — ручное read-only сравнение текущего source и старого root.
- R117 — настоящий ручной сертификат.
- Два независимых R118 — настоящие VPS-аудиты.
- Два независимых R121 — публичные SHA-256 снимки.
- R122/R127 — финальное сравнение независимых source run ID, jobs, артефактов и SHA.
- Пять старых JS-интеграций, маршруты, API, Auth/JWT/session/cookies и browser parity.
- Настоящие Auth/PostgreSQL/Storage backup+restore, RLS двух пользователей, восстановление/удаление данных, JWT.
- Privacy/security, rollback-canary и отдельное разрешение владельца.

Это **не формальная процедура выдачи GO** и не автоматически выполняемый cutover. Даже полный R133 PASS не может поменять этот статус: скрипт всегда создаёт отчёт с `productionCutoverAuthorized=false`, `realCustomerAuthStorageOrDatabaseMigrated=false` и `productionDecision=NO_GO`.

## Ограничения

Связанный Supabase ранее возвращал `projects: []`; без правильного project ref нельзя считать клиентские данные проверенными. R128–R131 доказали только восстановление синтетических PostgreSQL/PNG, а не реальных файлов Storage. R133 не закрывает [issue №135](https://github.com/osmanosmanov6880-bot/marcosa-fusion/issues/135) и [release gate №55](https://github.com/osmanosmanov6880-bot/marcosa-fusion/issues/55).

Рабочая `marcosa.club` остаётся на прежней платформе; нет изменений production SSH, Nginx/DNS, user DB, Storage, cookies или сессий.
