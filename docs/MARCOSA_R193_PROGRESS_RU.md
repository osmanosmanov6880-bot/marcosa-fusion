# MARCOSA R193 — Audit Desk, операторская независимая приёмка

Дата: 20 ноября 2026. Репозиторий: osmanosmanov6880-bot/marcosa-fusion, PR #168, ветка feature/marcosa-r150-growth-economics.

## Итоги R192
На контрольном SHA 77384d9c317b44c287bfc856c4656eaf7be60c8b все три задания R192 завершились SUCCESS. Это подтверждает синтетические проверки кода и изолированный PostgreSQL17, а не реальные права production.

## Пять крупных блоков R193
1. Сборщик наблюдений GitHub — ops/r193/github-observer.mjs. Ровно PR #168, source HEAD, base, runId, история review с пагинацией, проверка IDs трёх раздельных согласующих, отклонение отклонённых и устаревших решений, повторный HEAD. Только GET, без redirect, ограниченные ответы и TTL.
2. Строгий публичный intake — ops/r193/evidence-intake.mjs. Шесть типов операторских свидетельств (TLS, AWS, восстановление staging, privacy/legal, подтверждение личности, GitHub Environment). Принимаются только хеши SHA-256, enum-статусы и даты; нет свободного текста, PII или токенов. Срок действия ограничен 24 часами, никакая запись не означает независимую проверку.
3. Решение и план действий — ops/r193/assessment.mjs. Восемь контрольных направлений с ответственными, приоритетами и причинами: CI/source, PR reviews, human identity, GitHub Environment, TLS, AWS IAM/SCP/KMS, RPO/RTO restore, Privacy/legal. Отсутствующие и несовместимые факты блокируют приёмку.
4. Премиальный автономный мобильный отчёт — ops/r193/dashboard.mjs и ops/r193/operator-cli.mjs. Русский интерфейс в тёмно-синем цвете, адаптация 380/780px, карточки, сводка, очередь, SHA-источники, печать. Самодостаточный index.html без CDNs, remote JS, network, cookies и обработки PII. Отчёт включает HTML, Markdown и безопасный JSON. CLI работает только с явно разрешёнными read-only запросами.
5. Доказательства и независимый runner — ops/r193/signed-package.mjs, fixture.mjs, ci-producer.mjs, ci-verify.mjs, ops/test/r193.acceptance.test.mjs и workflow marcosa-r193-audit-desk.yml. Первый исполнитель создаёт публичный пакет, подписывает реально с помощью одноразового Ed25519 и публикует хеши. Второй без AWS, DB и секретов проверяет signature, public-key SHA, exact source/git-tree SHA, JSON-claim цепочку и заново вычисляет HTML и Markdown. Восемь негативных/приёмочных тестов.

## Как реально воспользоваться без деплоя
В корне checkout создать файл r193-evidence.json, содержимое которого можно взять из ops/r193/evidence.example.json.

Заполнить SHA40 exact head, SHA64 дерева пакета, GitHub runId и числовые GitHub reviewer IDs. Сборщик откажет, если данные не соответствуют PR. Для read-only GitHub подключения в терминале нужно установить R193_ALLOW_NETWORK=1 и при необходимости GITHUB_TOKEN с правом чтения.

Запуск (одна строка):
R193_ALLOW_NETWORK=1 node ops/r193/operator-cli.mjs --commit SHA40 --bundle SHA64 --run RUN_ID --security USER_ID --operations USER_ID --privacy USER_ID --evidence r193-evidence.json --out r193-audit

Готовые файлы r193-audit/index.html, report.md и evidence.json можно открыть офлайн, в том числе на телефоне. CLI не отправляет approval и не инициирует deploy.

Синтетический пример отображения интерфейса автоматически создаётся в Actions artifact marcosa-r193-offline-audit-desk. Это демо с подставными данными, а не результаты реальных организаций.

## Ограничения
- В CI GitHub API и внешние свидетельства смоделированы. Криптографическая Ed25519 подпись пакета реальна, но ключ создаётся CI и не связан с независимо установленной личностью.
- Настоящая принадлежность TLS сертификата, effective AWS SCP/KMS/IAM права, реальная DR/RPO/RTO, правовые разрешения, независимые согласующие не сертифицированы.
- Production NO-GO, realPilotAuthorized=false и productionAuthorized=false. main не менялся и никакого деплоя не производилось.
