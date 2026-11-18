# MARCOSA R163 — воспроизводимый релиз, Ed25519-аттестация, HTTPS-readback и независимый CI-runner

**Дата:** 18 ноября 2026 года  
**PR:** https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168  
**Ветка:** feature/marcosa-r150-growth-economics

## Проверенная реализация

Пять крупных инженерных блоков R163 внесены в код и прошли изолированную приёмку.

- [R163 two-runner source + Ed25519 + HTTPS CI #44310469565](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44310469565): SUCCESS, 15/15 модульных тестов R163, локальная TLS-проверка, точные подписи, воспроизводимый bundle и независимое повторное построение в другом GitHub runner.
- [Full R160–R163 PostgreSQL 17/TLS/recovery regression #44310469548](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44310469548): SUCCESS, **51/51** тестов R160–R163, настоящий pg@8.23.1 с TLS, signed JWT + Auth, транзакционная защита от отозванных сессий, pg_dump/pg_restore, R162 поломка соединений и отказ по устаревшим JWKS и неверному CA.

**Ограничение:** результаты CI созданы на GitHub runner с одноразовыми локальными пользователями, сертификатами, подписями и synthetic Supabase-shaped PostgreSQL. Ни одна из этих проверок не является проверкой реального управляемого Supabase проекта, внешнего VPS, независимого человека или фактической готовности к production.

## Блок 1 — воспроизводимый source bundle

**Файлы:** ops/r163/repro-bundle.mjs, ops/test/r163.repro-bundle.test.mjs; расширена допустимая R162 evidence-поддиректория.

- Пакет содержит **16 обязательных исходников**, включая R160 PostgreSQL transport и package-lock, R161 Auth/HTTPS/inbox, R162 release evidence/incident и пять R163 модулей.
- Проверяет точный full SHA коммита, git repository, канонический путь checkout, отсутствие symlink/hardlink и стабильность размера файла между lstat/open/read.
- Включает исходный байтовый контент в канонический JSON-пакет, сортирует пути, проставляет SHA-256 каждого файла, SHA-256 source manifest и SHA-256 всего пакета. Метаданные времени, права, пути с секретами, .env и токены не добавляются.
- Повторная проверка в другом процессе сравнивает загруженные байты с пакетом, пересобранным из нового checkout. Мутация любого файла, подмена digest, иной SHA или symlink -> отказ.
- Это комплект исходников для аудита, а не подписанный production-образ контейнера.

## Блок 2 — Ed25519 offline review challenge

**Файлы:** ops/r163/review-attestation.mjs, ops/test/r163.review-attestation.test.mjs.

- Детерминированно подписываемые поля: commit SHA, bundle digest, scope isolated-staging-audit, случайный 128-битный nonce и время действия максимум 15 минут.
- Проверяется Ed25519 через Node crypto; публичный ключ рецензента должен иметь заранее независимо закреплённый SPKI SHA-256 fingerprint.
- Нужны два РАЗЛИЧНЫХ пина — reviewer и builder; один и тот же ключ отклоняется.
- Неправильная подпись, прежний/будущий review, подменённый commit, тайный дополнительный JSON-ключ, попытка пометить как production-approved -> отказ.
- Проверка подтверждает **ключ, но не юридическую личность/независимость человека**. CI генерирует оба ephemeral ключа, поэтому в отчёте humanIndependenceEstablished остаётся false.
- Ни подписывание, ни локальная проверка **никогда не дают разрешение на deployment**.

## Блок 3 — HTTPS staging readback

**Файлы:** ops/r163/staging-readback.mjs, ops/test/r163.staging-readback.test.mjs.

- Read-only GET на строго фиксированный /.well-known/marcosa-stage.json.
- Точное HTTPS-origin hostname; обычный сервер не может переадресовать запрос на сторонний host или port.
- Проверяет CA/X509, hostname/SNI и pin public SPKI SHA-256; TLS >=1.2.
- Запрашивает новый nonce для каждого запроса. Ответ должен содержать exact commit SHA, bundleSha256, nonce, stage=isolated-staging, productionReady=false.
- HTTP redirects, cacheable response, JSON сверх 2048 байт, отсутствующие/лишние поля, устаревший nonce и подменённый SHA не принимаются.
- Только в изолированном GitHub runner тестовый сертификат staging.r163.example.invalid перенаправляется на loopback 127.0.0.1; это не подключение к реальному staging.
- Внешний staging host ownership и инфраструктура DNS/WAF этим тестом не подтверждены.

## Блок 4 — canary SLO

**Файлы:** ops/r163/slo-monitor.mjs, ops/test/r163.slo-monitor.test.mjs.

- Только числовые статус HTTP, задержка, verified TLS и matching readback. Нет логов персональных идентификаторов.
- Непересекающиеся окна результатов; пороги p95, errorPercent, время действия и минимальное число последовательных здоровых окон.
- Сбой TLS, неправильный body или HTTP!=200 моментально сбрасывает зелёный счетчик; старое окно истекает и не сохраняет ready.
- В CI используются три полных независимых окна по пять успешных synthetic probes.
- Это готовый операторский монитор, но не автономный production-сборщик реальных нагрузочных метрик.

## Блок 5 — read-only six-evidence release gate и две независимые CI jobs

**Файлы:** ops/r163/release-gate.mjs, ops/test/r163.release-gate.test.mjs, ops/r163/ci-acceptance.mjs, ops/r163/ci-verify-artifact.mjs, .github/workflows/marcosa-r163-release.yml; расширен .github/workflows/marcosa-r160-staging.yml.

Релизный шлюз требует:

1. полный коммит SHA + SHA256;
2. воспроизводимый source bundle;
3. Ed25519 reviewer key-signature с отличающимся builder key;
4. свежий pinned TLS HTTPS readback;
5. достаточное число непересекающихся свежих canary окон;
6. подходящее доказательство восстановления, совпадающее с commit и digest.

При неполноте любой проверки -> **BLOCKED**. При положительных только synthetic CI доказательствах -> **CI_SIMULATION_COMPLETE**, а не approval. При декларациях реальной инфраструктуры -> **READY_FOR_INDEPENDENT_STAGING_AUDIT**, а НЕ разрешение на deployment. Даже все зелёные чеки всегда возвращают productionAuthorized=false, paymentsEnabled=false, payoutsEnabled=false, independentHumanReviewEstablished=false.

R163 отдельный двухэтапный GitHub Actions:

- job A проверяет исходники, прогоняет 15 R163 тестов, создаёт ephemeral Ed25519 ключи и реальный локальный HTTPS сервер с X509/SPKI, проверяет nonce/redirect/SLO и формирует артефакт. Artifact хранится только 7 дней.
- job B в отдельном новом runner скачивает артефакт, проверяет manifest и оба SHA-256, а затем пересобирает исходники из нового checkout по тому же Git SHA. Никакого API ключа Supabase, SSH/production-кредита, внешнего развертывания или отправки уведомлений не вызывается.
- Расширенный R160–R163 workflow на том же коммите проходит 51/51 и всю предыдущую реальную PG17 CI-регрессию.

## Следующая внешняя приёмка — до production

1. Независимый reviewer проверяет repo/build и подпись с заранее утверждённым, отдельным публичным ключом. CI-эпhemeral signing не считается человеческим sign-off.
2. В настоящем разрешённом staging окружении проверяются TLS/CA/SPKI, DNS, права database roles и реальные Supabase Auth sessions с секретами в операционном vault.
3. Проверяются offsite encrypted backup/restore, пределы ошибок и задержек на репрезентативной нагрузке, наблюдаемость, rollback и удаление данных по запросам.
4. Подключение реального уведомительного провайдера, юридические и финансовые процедуры (реальные платежи/выплаты авторам) только после отдельного аудита и разрешения.

**Не делалось:** production deploy, merge в main, подключение настоящего Supabase, обработка реальных платежей/выплат и публикация на публичном сайте. Все новые модули в рабочей ветке PR #168.

## Официальные сведения Supabase, проверенные при реализации

- https://supabase.com/docs/guides/auth/sessions — связь signed JWT session_id с managed auth.sessions и ограничения сессий.
- https://supabase.com/docs/guides/security/tls — TLS 1.2/1.3 для API, актуальное предупреждение о старых CBC-шифрах (возможные изменения начиная с ноября 2026).
- https://supabase.com/docs/guides/platform/ssl-enforcement — требования SSL для PostgreSQL.

R163 не меняет управляемую схему Auth и не создаёт реальные Supabase migrations.
