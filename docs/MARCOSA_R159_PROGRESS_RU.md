# MARCOSA R159 — защищённый PostgreSQL, Auth и согласие

PR #168, feature/marcosa-r150-growth-economics. 18 ноября 2026 года.

Статус: пять модулей реализованы. Изолированный PostgreSQL 17 и тестовые ключи/пользователи. Без доступа к живому Supabase, без внешней отправки и денег.

## R159-1. Серверный PostgreSQL pool с проверкой сертификата

- Исходники: ops/r159/secure-pool.mjs; ops/test/r159.secure-pool.test.mjs.
- Запрещён connectionString override, TLS downgrade, привилегированные роли и непроверенный hostname.
- TLS: rejectUnauthorized=true, pinned operator CA PEM (валидность через X509Certificate) и проверяемое servername.
- Ограничение пула: 1–8 подключений, SQL и connection timeout.
- Preflight: подтверждение current_user, database, отсутствия BYPASSRLS, временное SET LOCAL ROLE marcosa_r156_writer, ROLLBACK/release.
- Pool-конструктор узко инъецируется trusted server; библиотека node-postgres и реальные секреты ещё не устанавливались. Нельзя считать это готовым production deployment.

## R159-2. Проверка существования настоящей Supabase Auth-сессии

- Исходники: ops/r159/supabase-sessions.mjs, docs/MARCOSA_R159_AUTH_READER_REFERENCE.sql, ops/test/r159.supabase-sessions.test.mjs.
- Для каждого изменения подтверждаются UUID sub+session_id, JWT exp и наличие соответствующего user_id в auth.sessions.
- Параметризованный SELECT выполняется отдельной read-only транзакцией через маркосу NOLOGIN auth-reader, с timeout, ROLLBACK и освобождением соединения.
- Отсутствие или удаление сессии, недоступность базы, подмена пользователя -> отказ.
- Только поля id и user_id, без email, user_metadata или refresh-token.
- Reference grants на управляемую таблицу Auth не применялись к реальному проекту; нужен независимый security-review. Факт наличия строки сам по себе не реализует все настройки time-box/inactivity Supabase.

## R159-3. JWKS ротация JWT с жёстким пиннингом

- Исходники: ops/r159/jwks-rotation.mjs; ops/test/r159.jwks-rotation.test.mjs.
- Единственный адрес: https://[projectRef].supabase.co/auth/v1/.well-known/jwks.json. Никакие jku, x5u, jwt-header URL не управляют источником ключей.
- Только ES256/RS256 через R157 verifier; одиночное параллельное обновление, TTL 30–600 секунд, timeout, лимиты размера/количества ключей.
- После истечения TTL при ошибке ключи НЕ продолжают использоваться. Проверена ротация A → B, отказ при приватном JWK и переадресациях.
- Сессия всегда проверяется отдельно, включая её отзыв.

## R159-4. Worker с последней проверкой согласия

- Исходники: ops/r159/outbox-worker.mjs; ops/test/r159.outbox-worker.test.mjs.
- PostgreSQL-операции: R156 claim, R157 delivery_fence, затем injected provider.send, после успеха ack. Отозванное право -> cancel, ошибка -> nack.
- Stable SHA-256 delivery idempotency key для эпизода и получателя; batch до 20, последовательная обработка, ограничения lease, PII-free logging.
- Отправитель обязан поддерживать идемпотентность и перепроверять согласие непосредственно перед реальным сетевым side effect.
- Подключения реального email/SMS/push провайдера здесь нет. Exactly-once delivery не гарантируется.

## R159-5. Тестовая приёмка и восстановление PostgreSQL 17

- Workflow: .github/workflows/marcosa-r159-security.yml.
- PostgreSQL fixture: tests/postgres/165_r159_auth_fixture.sql; 166_r159_session_delivery.sql; 167_r159_restored.sql.
- Четыре семейства Node tests, проверяющие TLS, Auth, JWKS, worker.
- Настоящая PostgreSQL 17 на loopback, R30/R41/R84/R155/R156/R157 и искусственная auth.sessions.
- Отзыв сессии -> отсутствие записи, запрет её просмотра для браузерных ролей.
- Реальная SQL-аренда одного уведомления, отзыв согласия, запрет delivery_fence, отмена lease и отказ старого ack; другая задача сохраняется.
- Реальный pg_dump --format=custom, SHA-256, pg_restore в отдельную PostgreSQL и повторные проверки приватности, RLS, сессий и состояний уведомлений.

## Источники

https://supabase.com/docs/guides/auth/sessions
https://supabase.com/docs/guides/auth/jwts
https://supabase.com/docs/guides/database/connecting-to-postgres
https://supabase.com/changelog?types=breaking-change

## Следующий рубеж

Реальный Supabase Auth и driver pool с доверенными полномочиями, TLS CA, secrets manager, staging, внешний delivery transport, независимый review и восстановление из отдельного encrypted/offsite backup. До этого коммерческая система и payments/payouts остаются NO_GO. Main и публичный сайт не затрагивались.
