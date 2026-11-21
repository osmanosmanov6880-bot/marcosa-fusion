# MARCOSA R160 — пять больших блоков, настоящая TLS-приёмка PostgreSQL

Дата: 18 ноября 2026 г.
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
Ветка: feature/marcosa-r150-growth-economics

**Итог:** реализация R160 в PR, изолированная приёмка GitHub Actions успешна:
- https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44295699428 — 12/12 тестов, реальный подписанный HTTP → CA-verified node-postgres → PostgreSQL 17, отписка/лог-аут, pg_dump/pg_restore и RLS.
- https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44295710041 — повторная успешная R160-приёмка на implementation commit a43a1c1515ff8642078c70e4a1ace2178b13f54b.
- На том же SHA прошли R155, R156, R157, R158, R159, finance/DR и social-lab. Браузерная регрессия R151 в отдельном workflow при последнем опросе ещё выполнялась.

**ОГРАНИЧЕНИЕ:** все учетные записи, TLS CA, JWT, сессии, уведомления, платёжные данные и PostgreSQL здесь синтетические и одноразовые. Пользовательские базы, настоящий Supabase, VPS и production не подключались и не менялись. Созданный staging runtime не запускается сам.

## 1. Настоящий pinned node-postgres 8.23.1

Файлы:
- ops/r160/package.json
- ops/r160/package-lock.json
- ops/r160/pg-driver.mjs
- ops/test/r160.pg-driver.test.mjs

В отличие от R159 интерфейса для injected Pool, в R160 используется настоящий node-postgres 8.23.1, зафиксированный по версии с проверяемыми SHA-512 integrity для всех 14 прямых/транзитивных пакетов в committed lockfile. npm ci вызывается с --ignore-scripts, без неявного перехода на свежие версии.
Драйвер подключается исключительно к доверенному оператором PostgreSQL-хосту. Проверяются X.509 CA и срок сертификата, hostname совпадает с expectedHost, ssl.rejectUnauthorized=true, servername, минимальный TLS 1.2, лимиты пула и тайм-ауты. Серверная роль не может быть postgres, service_role или браузерной ролью. Preflight проверяет текущий пользовательский логин, отсутствие BYPASSRLS и возможность временно войти в marcosa_r156_writer. После проверки — ROLLBACK и release.
Нет переменных с живым паролем в репозитории, нет подключения к продакшен-серверу.

## 2. Полноценная сборка staging-сервиса

Файлы:
- ops/r160/staging-service.mjs
- ops/test/r160.staging-service.test.mjs
- ops/r159/jwks-rotation.mjs (добавлен warmKeys)

Сервис соединяет:
- настоящий pg Pool с проверенным сертификатом;
- Supabase-shaped auth.sessions checker с отдельной read-only ролью;
- pinned ES256/RS256 JWKS verifier (реальная ротация и warm-up);
- существующий R157 командный HTTP-шлюз с семью операциями;
- PostgreSQL trusted writer с BEGIN, SET LOCAL ROLE и параметризованными запросами.

При запуске сервис сначала проверяет PostgreSQL writer, затем роль чтения auth.sessions и правильность набора открытых JWT-ключей. Пока доказательств нет или срок их свежести истёк, модификации возвращают отказ. JWKS и Auth отказывают fail-closed. Повторная preflight сериализована; после её неудачи запись закрывается. Listen разрешён только на 127.0.0.1; нужен внешний независимо защищённый reverse proxy для реального staging.
Нет автоматического деплоя, внешнего входа через 0.0.0.0 или productionReady=true.

## 3. Управление staging, readiness и безопасное завершение

Файлы:
- ops/r160/control-plane.mjs
- ops/test/r160.control-plane.test.mjs

На отдельном loopback сокете доступны:
- GET /live: процесс жив, но это НЕ production readiness;
- GET /ready: HTTP 200 только если все staged checks свежи, иначе 503;
- POST /preflight: проверка только с отдельным длинным Bearer admin токеном, без cookie/Origin/body;
- POST /drain: перевод в stop, больше никаких mutations;
- GET /metrics: счётчики проверок и отказов, без identities, email, tokens или CA.

Ненадёжное соединение, отключение role/DB и неверные данные блокируют доступ. Секреты в ответах не фигурируют. Admin endpoint слушает только localhost, внешнее выполнение команд не реализовано. При завершении закрываются серверные соединения.

## 4. Staging webhook delivery, подписанные сообщения и последняя проверка согласия

Файлы:
- ops/r160/webhook-provider.mjs
- ops/test/r160.webhook-provider.test.mjs
- ops/r159/outbox-worker.mjs (добавлена повторная проверка текущего lease перед провайдером)

Provider обязан принимать HTTPS-запрос только на заранее закреплённый hostname и путь /v1/notifications/deliver. Проверяются серверный CA, отсутствие redirect/query/userinfo, точная idempotency-key, HMAC-SHA256 на timestamp+nonce+idempotency-key+JSON-body. До вызова HTTPS делается **ещё одна** проверка lease и согласия. Отзыв -> ConsentRevokedError -> cancel без сетевой отправки. Неуспешная сеть -> nack и повтор с тем же dedupe key. Для accepted=true необходим HTTP 202 и точное подтверждение idempotency key от провайдера.
По умолчанию allowNetwork=false. Реальных email/SMS/Push и реального коммерческого провайдера нет; тесты используют injected transport. Нет ложного обещания exactly-once: потерянный ack и гонки с внешним side effect требуют подтверждённого поведения поставщика и отдельного аудита.

## 5. Реальная PostgreSQL 17 TLS + HTTP + backup/restore

Файлы:
- .github/workflows/marcosa-r160-staging.yml
- ops/r160/ci-real-pg.mjs
- tests/postgres/168_r160_restored.sql
- ops/test/r160.*.test.mjs

На GitHub runner создаётся PostgreSQL 17-alpine и **временный root CA + серверный сертификат** с IP SAN 127.0.0.1. На PostgreSQL включается TLS. Клиент подключается настоящим pg 8.23.1 через ssl.rejectUnauthorized с проверкой CA/имени. Создаётся отдельный marcosa_r160_ci LOGIN NOINHERIT NOBYPASSRLS, который может только SET LOCAL ROLE для проверенного writer и auth-reader.

Энд-ту-энд:
1. Реальный TLS-запрос подтверждается через pg_stat_ssl.ssl=true.
2. Подписанный CI ключом ES256 JWT проходит pinned JWKS, issuer/audience, Auth session_id, Origin и шлюз.
3. Настоящий HTTP POST к редакторской функции меняет revision 0→1.
4. Тот же idempotency key возвращает прежний ответ; другая полезная нагрузка и старая revision отвергаются; злоумышленный Origin и роль service_role отклоняются.
5. Строка Auth-сессии удаляется отдельным администратором одноразовой базы, следующий запрос через тот же JWT получает 401.
6. Создаётся настоящая PG17 custom backup, проверяется SHA-256, данные восстанавливаются в новую БД. Проверяются сохранённый текст, ровно один принятый запрос, отсутствие отозванной сессии, RLS и запрет чтения auth.sessions браузерной ролью. Повреждённый backup отклоняется.

Дополнительные unit tests: 12/12, защита от неверной CA, privilege, origin, weak admin secret, lease consent race, webhook redirect и mismatch idempotency.

## Supabase compatibility

Подтверждено по официальной документации Supabase на момент R160:
- Для постоянных backend-сервисов предпочтительно direct PostgreSQL или session pooler в зависимости от IPv6/IPv4.
- SSL mode require шифрует, но не проверяет удостоверение сервера; нужен verify-full или эквивалент настройки драйвера с корневым CA.
- Supabase CLI v3 по умолчанию локальный и подтверждает удалённые действия; 2026 изменились правила Data API exposure. R160 не использует CLI для hosted изменений.
- Настоящие Auth sessions, индивидуальные роли и функции безопасности на управляемом Supabase нельзя внедрять автоматически по synthetic PG17 reference.

Ссылки:
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/platform/ssl-enforcement
- https://supabase.com/changelog?types=breaking-change
- https://supabase.com/docs/guides/auth/sessions

## Production NO_GO

До внешней миграции: подтверждение Supabase projectRef и реальные managed auth.sessions grants, независимый staging-домен + TLS/reverse proxy, secrets manager и CA trust, CI signed artifacts, наблюдаемость, резервное копирование из удалённого защищённого хранилища, подтверждение провайдера уведомлений, аудит личных данных, налоги/платежи/выплаты и утверждение release. Ветка main и публичный сайт не менялись.
