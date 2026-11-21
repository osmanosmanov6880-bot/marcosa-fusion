# MARCOSA R187 — DNS-pinned HTTPS, Ed25519, минимизация данных и приёмка PostgreSQL 17

20 ноября 2026 · PR #168 · ветка `feature/marcosa-r150-growth-economics`

## Пять полноценных инженерных задач

**1. Защищённый read-only HTTPS транспорт без DNS rebinding.** `ops/r187/pinned-https.mjs` и обновлённый `ops/r186/operator-preflight.mjs` выполняют предварительное резолвинг домена, разрешают только публичные IPv4, блокируют смешанные публичные/частные A-записи, IPv6-only, RFC1918, loopback, link-local и подозрительные ranges. Адрес закрепляется в TLS-запросе на одном IP и исходном SNI, HTTPS-сертификат проверяется Node.js, редиректы/учётные данные запрещены, доступны только `GET /health`, `GET /ready` и `HEAD /`. Всего три анонимных запроса. В CI транспорт испытывается моками — это не реальная TLS-аттестация. Для IPv6-only инфраструктуры проверка намеренно fail-closed.

**2. Двойная криптографическая Ed25519-проверка.** `ops/r187/dual-attestation.mjs` требует два разных заранее закреплённых открытых ключа Ed25519 формата SPKI, два разных идентификатора и роли `PR_REVIEW`/`SECURITY_REVIEW`. Сообщение с доменным разделением привязано к HEAD SHA, source bundle SHA, SHA GitHub/новой DNS-pinned HTTPS-проверки, run ID, одноразовому nonce и короткому временному окну. `staging-gate.mjs` независимо повторяет криптографическую проверку подписи: подмена флага `verified=true` не проходит. В CI генерируются эфемерные ключи; реальные люди, право подписи и GitHub approvals **не считаются подтверждёнными** от одного криптографического факта.

**3. Проверка реального PostgreSQL 17 retention без клиентских данных.** `ops/r187/privacy-retention.mjs` + `tests/postgres/188_r187_secure_retention.sql`: в одноразовую БД вносятся 12 искусственных SHA-идентифицированных событий, четыре истёкших удаляются отдельной NOLOGIN-ролью через RLS DELETE только `expires_at < statement_timestamp()`, восемь действующих сохраняются. У роли нет INSERT/UPDATE, у аудитора нет DELETE и у `authenticated` нет доступа. Контроль source high-water и закрытого quarantine выполняется дважды. Это демонстрация удаления в тестовой базе, **не** доказательство соответствия GDPR или политики реальной БД.

**4. Неизменяемое NO-GO решение.** `ops/r187/staging-gate.mjs`, `ops/r187/tls-proof.mjs`, `ops/r187/observation-ledger.mjs` — source-bound цепочка R186 → DNS-pinned HTTPS → две реально проверенные Ed25519-подписи → retention. Результат только `NO_GO_REAL_STAGING_ATTESTATION_PENDING`. В нативном PG17 `SERIALIZABLE`, JOIN с предыдущим `R186`, 8 оставшихся и 0 истёкших записей, отдельный audit и запрет повторов, FORCE RLS. Никакого `GO`, публикации или выхода из карантина.

**5. Негативные тесты и независимая приёмка.** `ops/test/r187.staging.test.mjs`, `ops/r187/ci-acceptance.mjs` и `.github/workflows/marcosa-r187-readiness.yml`: тесты DNS-private/mixed, неразрешённые URLs, подписи чужим ключом, порча SHA и nonce, невозможность удаления живых событий, блокировка расширенных ролей, восстановление нативного PG17 из `pg_dump -Fc` в другую БД, проверка FORCE RLS, карантина и отклонения SQL replay. Второй runner без доступа к БД/облаку проверяет всю SHA-цепочку и provenance. Контрольный source manifest — **175 файлов**.

## Границы и следующий практический шаг

Запуск оператора возможен только вручную из reviewed checkout с переменными R186 и разрешённым staging FQDN, read-only GitHub token остаётся локально у оператора. Прямого доступа к реальным staging/AWS в CI нет. В тестах сертификат/HTTP/API, Ed25519-личности и их права **синтетические**; actual GitHub approvals, AWS/SCP/KMS, независимость людей, prod privacy и recovery/RPO/RTO не аттестованы. Успешный CI не даёт разрешения на реальные клиентские данные. `realPilotAuthorized=false`, `productionAuthorized=false`.

Техническая приёмка: оба GitHub Actions jobs SUCCESS на одном полном SHA. `main`, production, сайт, реальные клиентские записи, платежи и AWS не изменяются.
