# MARCOSA R190 — независимые подтверждения источника, PG17 и строгий NO-GO

20 ноября 2026. Ветка PR #168.

## Пять крупных инженерных блоков
1. **GitHub API review chronology:** `ops/r190/github-review.mjs`: только фиксированный PR #168, фиксация exact SHA head, до 1000 событий с пагинацией, проверка последнего решения каждого одобряющего, запрет self-review, bot-review, устаревшего SHA и дублирования ролей; read-only GET, без redirect. Назначения ролей и настоящая личность отдельно не удостоверяются.
2. **Криптографическая проверка 3 Ed25519:** `ops/r190/human-signatures.mjs`: публичные SPKI и SHA256 pins из внешнего реестра; SECURITY, OPERATIONS, PRIVACY; подписи exact source/HTTPS/GitHub receipt, challenge nonce, 5-минутный TTL, запрет повторного ключа, отозванного ключа и подмены ролей. В CI ключи эпизодические: они не устанавливают юридически проверяемые личности.
3. **Безопасный реальный операторский HTTPS readback:** `ops/r190/https-readback.mjs`: переиспользованы R186/R187, три безучётных GET/HEAD, DNS-pin на глобальные IPv4, TLS hostname validation, ограниченные ответы, без redirect, тела не сохраняются. Выключен без explicit opt-in. DNSSEC, независимый аудит сертификата и право на деплой не подтверждаются.
4. **Нативный PG17 журнал без возможности GO:** `tests/postgres/190_r190_immutable_no_go.sql`, `ops/r190/native-ledger.mjs`, `ops/r190/ci-native-pg17.mjs`: SERIALIZABLE, FORCE RLS, NOLOGIN, атомарные hold/audit, недоступность browser-ролей, UPDATE/DELETE запрет, replay отказ, реальный `pg_dump -Fc` и восстановление в независимую БД, повторная проверка SHA / RLS / NO-GO.
5. **Связанный release assessor и CI:** `ops/r190/final-gate.mjs`, `ops/test/r190.contract.test.mjs`, `.github/workflows/marcosa-r190-integrity.yml` — exact source, криптографическая связь GitHub/HTTPS/Signatures и негативные тесты. Даже все положительные синтетические claims оставляют `NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING`.

## Ограничения
CI использует синтетические ответы GitHub, staging и отдельный disposable PG17. Это не фактическая проверка продовой инфраструктуры. Реальные AWS IAM/SCP/KMS, GitHub Environment, независимая TLS/личность проверяющих, live Privacy/legal, RPO/RTO и запуск требуют отдельной операторской приёмки. Нет изменения main, customer data, платежей или деплоя.
