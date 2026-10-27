# MARCOSA R137 — исправление race condition Pages ↔ R116/R136

Дата: 27 октября 2026. Сфера: **только GitHub Actions read-only приёмка**, production остаётся **NO-GO**.

## Реальный инцидент

Слияние [R136 PR #154](https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/154)
дало main `d17373ca4eb4d96b0bf5a23c226928b7a00fee8e`.
Проверки R48, STAGING, R114 и R116 завершились раньше Pages.
[Реальный запуск R136 #40528068482](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40528068482)
завершился FAIL с сообщением `R133_FAIL_CLOSED=Exact-main pages workflow missing, stale, duplicated, skipped or not success`.
Строгий R133 правильно не выдал ложный PASS: на момент проверки Pages ещё выполнял HTTPS byte readback.
Pages действительно завершился успешно позднее на том же SHA. Это **не** восстановление customer Auth/Storage.

## Исправление

- Прежде чем выполнять R133, R136 теперь ждёт **все пять** целевых workflow: R48, Pages, STAGING, R114, R116.
- Не более 24 циклов проверки с интервалом 15 секунд; только GitHub API GET.
- Проверяются exact main SHA, branch, repository, event, имя workflow, реальное завершение.
- Для каждой стадии берётся новейший подходящий run; его failure / cancelled / skipped не маскируются более старым PASS.
- Если main сдвинулся, возвращена неполная страница API, нужный workflow не появился или истёк предел ожидания — FAIL.
- Получение `READY_FOR_R133_STRICT_JOB_ARTIFACT_VERIFICATION` **не является PASS релизной цепочки**. После ожидания прежний R133 независимо проверяет обязательные jobs и содержимое артефактов R114/R116.
- Добавлены негативные тесты: задержка Pages после R116, отказ Pages, чужой репозиторий, чужой SHA, неполная пагинация, сдвиг main, произвольная конфигурация, чрезмерное ожидание.

## Безопасность

Нет изменений SSH-ключей, VPS, DNS, Nginx, production root, Supabase, private Storage, реальных пользователей, реальных платежей и модулей legacy.
Любой отчёт сохраняет `productionDecision=NO_GO`.
Ручные R132/R117/2×R118/2×R121/R122/R127, реальная auth/storage recovery и письменное разрешение владельца остаются обязательны.

## Приёмка

После merge проверить на **новом main** успешный реальный R48/Pages/STAGING/R114/R116, затем R136 job `automatic-readonly-proof` со статусом `success`, а не только workflow-level зелёную галочку. Убедиться, что его artifact `marcosa-r136-current-main-automatic-proof-no-go` содержит точный SHA, все пять стадий и `productionDecision=NO_GO`.
