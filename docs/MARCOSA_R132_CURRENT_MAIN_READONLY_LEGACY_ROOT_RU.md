# MARCOSA R132 — CURRENT MAIN source ↔ legacy production, строгий read-only контроль

Дата: 26 октября 2026 года. Статус этого блока: защищённая проверка источника, **production NO-GO**.

## Выявленная ошибка R100

Ранее workflow R100 скачивал артефакт **R99**, закреплённый за run ID 40232174313 и старым коммитом 863adfdd. При последующих релизах такие сравнения нельзя считать проверкой **текущего** кандидата. Кроме того, предыдущий workflow мог запускать SSH-аудит после push в собственный workflow, а не только по явному запросу оператора.

## Что изменено

- Удалена ссылка на прежний R99 артефакт и tar из старого CI.
- Текущий проверяемый **источник** — site/index.html из точно того же main, на котором вручную запускается аудит. Перед SSH проверяется git rev-parse HEAD == GITHUB_SHA и SHA-256 байтов источника. Не используется «последний зелёный» run.
- Реальный VPS-контроль — **только** workflow_dispatch на main с явным подтверждением AUDIT-PRODUCTION-READONLY. Из pull request запускаются исключительно автономные негативные тесты Node.js, **без SSH**, а push полностью убран.
- Сохраняется pinned SSH host key, проверка SSH-ключа с ожидаемым публичным fingerprint, пользователь marcosa-deploy, проверка текущего каталога /opt/marcosa/current, чтение индекса, размера и списка allowlisted legacy-модулей. Root, DNS/Nginx и живые файлы **не изменяются**.
- Новый ops/r132_current_main_readonly_parity.mjs требует одну полную структурированную запись от SSH, root-owned защищённый каталог, отсутствие права записи у marcosa-deploy, полный digest и размер файла, непротиворечивые счётчики и ограниченный список имён компонентов. При чужом значении, неполном/повторённом поле, возможности записи в production или неверном SHA — отказ, а не ложный PASS.
- В GitHub Actions публикуется **только очищенный** marcosa-r132-current-sha-readonly.json; сырые SSH-строки, секреты, имена хостов и содержимое пользовательских файлов не сохраняются.
- Наличие пяти старых компонентов, совпадение index.html, успешно завершённый SSH и даже R132 PASS **не являются доказательством** переноса сессий, сохранения API/роутов, соответствия живого Storage/DB и не разрешают production.

## Запуск после CI-приёмки и объединения

1. Убедиться, что R132 находится в main, Pages/STAGING/R48/R116 действительно выполнены **для того же нового SHA**.
2. Оператор открывает GitHub Actions → workflow **MARCOSA | R132 exact main source vs legacy root (READ ONLY, MANUAL)** → **Run workflow** → выбрать main и ввести AUDIT-PRODUCTION-READONLY. Без этой строки настоящий VPS job обязан остаться skipped.
3. Проверить offline-contract=success, production-compat-readonly=success и свежий очищенный артефакт. Проверить sourceSha, productionDecision=NO_GO и authJwtCookiesAndApiRuntimeParityProven=false. Старые R99/R100 результаты не использовать.
4. Точно так же отдельно вручную исполнить **R117 → два R118 → два R121 → R122/R127** (тот же current main SHA). R132 их не заменяет.

## Что остаётся заблокированным

- Старая production имеет 5 critical JS интеграций и другие исторические legacy-only assets. Текущий source/HTML статически сравнивается, но его **динамическая** Auth/API/cookie/navigation функциональность пока не воспроизведена в новой версии.
- Доступ к реальному проекту Supabase/Auth/PostgreSQL/Storage не подтверждён. Синтетические R128–R131 испытания PG17 и PNG полезны, но не равны реальным backup, recovery и tenant isolation.
- Supabase подчёркивает, что backup базы содержит метаданные Storage, а **файлы Storage необходимо переносить отдельно**: https://supabase.com/docs/guides/platform/backups
- Требуются test restore настоящей базы и объектов в изолированной среде, реальные тестовые JWT двух пользователей, privacy/RLS/legacy checks, rollback и явное human GO владельца.

Никаких автоматических production изменений. Работающий marcosa.club, пользовательские данные, DNS/Nginx, Auth и Storage не затрагиваются. **Production NO-GO.**
