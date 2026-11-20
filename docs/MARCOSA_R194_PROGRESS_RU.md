# MARCOSA R194 — независимый мобильный интерактивный Audit Desk
Дата: 20 ноября 2026. Ветка: feature/marcosa-r150-growth-economics, PR #168.

## Принятие R193
R193 прошёл оба GitHub Actions задания (2/2 SUCCESS) на source SHA 01c0d698bb40e192b0178a3250a271a2a38f8abc. Ранее обнаруженная ошибка ожидания негативного теста исправлена без изменения защитной проверки.

## Пять полноценных блоков
1. **Локальный журнал выполнения**: ops/r194/task-ledger.mjs. Восемь обязательных контролей, состояния OPEN/IN_PROGRESS/BLOCKED_LOCAL/DONE_LOCAL, определённые переходы, роли ответственных и цепочка SHA-256 событий; replay обнаруживает подмены/повторы, дата ограничена сроком исходной R193 оценки. DONE_LOCAL означает локальную работу, не настоящую внешнюю аттестацию.
2. **Сравнение свидетельств**: ops/r194/evidence-delta.mjs. Ровно два source-bound R193 intake, валидность времени и типа источника, шесть категорий, ADDED/WITHDRAWN/HASH_CHANGED/CLAIM_CHANGED/HASH_AND_CLAIM_CHANGED; даже PASS_CLAIM не получает реальное право GO.
3. **Изменение рисков**: ops/r194/risk-trend.mjs. Сверка двух R193 оценок одного коммита и дерева, восемь неизменных обязательных направлений, регрессии и заявленные улучшения; никакой автоматической авторизации production.
4. **Рабочий мобильный офлайн-интерфейс**: ops/r194/interactive-dashboard.mjs + ops/r194/client.js + ops/r194/operator-cli.mjs. Поиск, фильтрация по статусу, кнопки локального выполнения/возврата/препятствий, экспорт/импорт ограниченного JSON-черновика, запуск без бэкенда. Поддержаны клавиатура, мобильная адаптация, скриншоты 390/1440 px, CSP hash для единственного встроенного JS, connect-src none, без localStorage/CDN/tracking. Отчёт по двум R193 evidence.json генерируется локальным CLI, без внешнего доступа.
5. **Независимая криптография, CI и настоящий Chromium**: ops/r194/portable-package.mjs, fixture.mjs, ci-producer.mjs, ci-verify.mjs; негативные тесты в ops/test/r194.acceptance.test.mjs; Playwright Chrome 390/1440 в tools/browser/r194-audit-desk.mjs; три CI jobs в .github/workflows/marcosa-r194-workbench.yml. Подписанный реальным одноразовым Ed25519 пакет связывает обе версии R193, журнал задач, анализ изменений и точный Git SHA, ре-генерирует HTML и Markdown вторым runner без секретов. Artifact marcosa-r194-mobile-audit-desk должен содержать готовый автономный index.html; screenshots выпускаются отдельно.

## Использование с реальными локальными документами
1. Получить два отчёта evidence.json через R193 operator-cli, переименовать в before.json и after.json. Обе версии должны быть для одного и того же исходного коммита и bundle SHA, а вторая — более поздней.
2. Выполнить: node ops/r194/operator-cli.mjs --before before.json --after after.json --out r194-audit
3. Открыть r194-audit/index.html на телефоне; поиск, локальное выполнение задач, экспорт/импорт JSON работают без сервера и не пишут в GitHub. Для повторного посещения вручную сохранить JSON; вкладка не хранит информацию в localStorage.

## Ограничения
Никаких настоящих привилегий AWS/доступа к production, данных клиентов, OAuth, платёжных систем, отправки согласований или деплоя нет. Тестовые данные CI не являются подтверждением внешних лиц, юридической безопасности, TLS/DR/IAM. Решение всегда NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED, реальные пилоты и production запрещены. main не менялся.
