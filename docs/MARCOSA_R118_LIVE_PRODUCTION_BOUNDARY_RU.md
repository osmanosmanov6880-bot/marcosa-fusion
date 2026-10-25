# MARCOSA R118 — независимая живая проверка границы production (READ ONLY)

## Цель

R117 доказывает целостность **статического публичного preview**; он не проверяет, можно ли заменить рабочий `https://marcosa.club/`. Это разные продукты. R118 **после успеха R117** перепроверяет текущий SHA, а затем строго с правами `marcosa-deploy` проверяет существующий root-owned production webroot `/opt/marcosa/current` против изолированного STAGING.

R118 намеренно не изменяет ни одного файла сервера. Результат удачного **аудита**: `R118_REAL_PRODUCTION_PARITY_AUDIT=PASS`, но выпуск **production** остаётся `R118_PRODUCTION_DECISION=NO_GO`.

## Что работает

1. `.github/workflows/marcosa-r118-production-boundary.yml` активируется после успешного R117 `workflow_run` в проверенном `main` или по явному ручному запуску. Pull request запускает только автономные тесты без SSH/секретов.
2. Перед SSH независимо повторяется полный трёхканальный сертификат через `ops/release_certificate_r117.mjs`. Если `main` изменился, проба останавливается до подключения.
3. Серверный адрес, порт, ED25519 host fingerprint, конкретный ключ `marcosa-deploy`, `StrictHostKeyChecking=yes` и ограниченная учётная запись проверяются до чтения сервера.
4. На VPS по SSH передаётся только существующий `tools/production_parity_audit.py`, который читает **только публичный index.html и публичные имена файлов** действующей и STAGING версий плюс проверенный манифест STAGING. Он не просматривает приватную БД, аккаунты, Nginx, секреты или приватный Storage; на VPS ничего не записывается.
5. `ops/production_boundary_r118.mjs` валидирует точный SHA, R117 и схему R101; неизвестные имена, некорректные хеши, поддельные флаги и несогласованные счётчики отклоняются.
6. В отчёт `marcosa-r118-production-boundary.json` входят только контрольные суммы публичного индекса, количественные различия и пять заранее разрешённых имён legacy-интеграций. Сырые файлы сервера и весь исходный JSON ответа **не публикуются**. Артефакт GitHub хранится 14 дней.

## Главный критерий безопасности

Даже если главные страницы стали побайтно одинаковыми, **прямая замена production не разрешена**. Поля `productionDecision=NO_GO`, `productionAuthorized=false`, `directRootReplacementAllowed=false`, `accountsMigratedOrVerified=false`, `databasesBackedUpAndRestored=false` не заменяются автоматически на GO.

Особенно опасна потеря legacy API/маршрутов и компонентов `marcosa-config.js`, `marcosa-supabase.js`, `interaction-bridge.js`, `developer-console.js`, `nexus.js`. Если эти файлы отсутствуют в static preview, R118 фиксирует их как конкретный риск.

## Что необходимо до любого изменения marcosa.club

- Фактически подключённый и согласованный проект Supabase со staging Auth/JWT/MFA, RLS, настоящими раздельными тестовыми учётными записями и Storage; проверка `app_metadata`, а не пользовательского `user_metadata`, при авторизации.
- Подтверждённый полный зашифрованный резервный архив **существующих** PostgreSQL, Storage и конфигурации с документированным независимым восстановлением, временем RTO/RPO и ответственным владельцем.
- Полный список legacy маршрутов, API, сессий, авторизации, загрузок, сохранений, редиректов и обратной совместимости. Использовать параллельный canary, а не `rsync --delete` рабочего корня.
- Отдельный изолированный HTTPS STAGING с TLS, собственным origin и проверкой cookies/Storage против production.
- Независимый security/privacy/legal аудит, подтверждение прав на медиа, реальные добровольные бета-пользователи, испытания модерации и человеческий go/no-go.
- Для монетизации — подтверждённый именно MARCOSA merchant/provider, финансовая отчётность, возвраты и защита платёжных событий.

Подключённый Supabase был вновь проверен 26 октября 2026: организация существует, но доступные проекты — `projects: []`. Мы **не** создавали платный проект и **не** меняли базу данных.

## Ссылки

- [R118 live boundary workflow](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r118-production-boundary.yml)
- [R117 triple proof](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r117-release-certificate.yml)
- [R101 исходный read-only аудит](https://github.com/osmanosmanov6880-bot/marcosa-fusion/blob/main/docs/MARCOSA_R101_R102_COMPATIBILITY_HTTP_QA_RU.md)
- [Issue #55 — открытые зависимости production](https://github.com/osmanosmanov6880-bot/marcosa-fusion/issues/55)

**R118 — важный самостоятельный инфраструктурный этап, но он не является миграцией пользовательских данных и не делает статический сайт заменой исходного production.**
