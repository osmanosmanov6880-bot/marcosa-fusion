# MARCOSA R179 — аудит согласований GitHub, репликации S3 и неизменяемая цепочка решений

19 ноября 2026 · PR #168 · feature/marcosa-r150-growth-economics

## Пять крупных блоков

1. **История конкретных согласований GitHub** (`ops/r179/github-approval-audit.mjs`). Read-only GitHub REST `GET /actions/runs/{run_id}` и `GET /actions/runs/{run_id}/approvals`. Проверка точного SHA, ветки, workflow_dispatch, инициатора и не менее двух разных User ID, которые одобрили одну staging environment, с запретом самоодобрения, повторяющихся, отклонённых, чужих и устаревших записей. Сеть по умолчанию выключена. В CI — полностью синтетические ответы; реальных людей или истинные провайдерские approvals CI не устанавливает.
2. **Признаки репликации S3** (`ops/r179/replication-provenance.mjs`). Повторный полный ciphertext SHA256 через R178, затем GetBucketReplication и HeadObject точных версий в исходном и offsite аккаунтах; ожидается `COMPLETED`/`REPLICA`, точный prefix, role, destination, отсутствие delete marker replication, checksum, Object Lock и source metadata. В CI — официальные классы AWS SDK v3 с инжектированными синтетическими ответами. Это проверяет контракт, но не доказывает реальную cross-account доставку.
3. **Fail-closed согласование решения** (`ops/r179/review-gate.mjs`): R178 доказательство с точным SHA-256 и уже записанная в PG17 R177/178 история, двойное чтение базы до/после REST/S3, полное GET объекта перед доверием replication status, bound review-history и TTL. Разрешён только `CI_SIMULATED_REVIEW_ONLY`. Нет признака `PRODUCTION_GO`.
4. **Нативный PostgreSQL17 append-only журнал** (`tests/postgres/180_r179_staging_review.sql`, `ops/r179/staging-ledger.mjs`): RLS+FORCE RLS, роль NOLOGIN без UPDATE/DELETE, SERIALIZABLE, FK на R178, JOIN c R177 restored outcome и R178 аудитом, атомарная запись evidence+audit, отказ при повторах и гонках.
5. **CI-доказательства и негативные испытания**: тесты self-approval, rejected/pending, stale/wrong SHA, самовольного репликационного правила, незаполненного Object Lock, коррупции байтов, replay и сдвига базы; повторно используется **та же** тестовая AES-256-GCM копия из R178, `pg_dump -Fc` и `pg_restore` в новый настоящий disposable PostgreSQL 17, затем второй независимый runner без PG/AWS, который проверяет исходные SHA и неизменность ограничений.

## Границы достоверности

В CI настоящая одноразовая БД PostgreSQL 17. GitHub review history и AWS S3 приёмочные ответы **синтетические**, а подтверждение шифротекста использует синтетические данные без ключа при переносе между этапами. Ни один этот тест не доказывает, что GitHub reviewers — реальные независимые люди, AWS accounts и реплики существуют, у IAM действительно выставлены правила, или что восстановление производственной БД успешно. `productionAuthorized=false`. Production, публичный сайт, main и клиентские данные не тронуты.

Приёмка требует SUCCESS обоих jobs GitHub Actions R179 на одном точном commit SHA.
