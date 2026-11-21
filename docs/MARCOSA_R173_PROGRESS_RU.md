# MARCOSA R173 — offsite-only disaster recovery с независимым KMS

Дата: 19 ноября 2026 года
Репозиторий: https://github.com/osmanosmanov6880-bot/marcosa-fusion
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
Branch: feature/marcosa-r150-growth-economics

## Суть R173 и реальное состояние

Реализованы пять новых инженерных блоков и настоящий сквозной тест на одноразовой PostgreSQL 17. Цель: восстановление исходного дампа при недоступном source S3 и source KMS благодаря независимо зашифрованному AES-256 data key, подписанному offsite escrow и отдельному destination storage.

Подтверждённая первая успешная интеграционная проверка:
https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44562328600

На ней прошли 13/13 новых R173 tests, 24/24 R171–R172 tests, реальный native pg_dump -Fc/pg_restore, проверка RLS, sessions, nonce и аудита. Для самого последнего SHA после документации следует отдельно посмотреть соответствующий CI.

Строгое ограничение: все GitHub/AWS/KMS/S3 provider responses в CI смоделированы и не обращаются к реальному AWS. Реальные Docker PostgreSQL 17, SQL транзакции, AES-GCM, Ed25519 и официальные AWS SDK v3 classes используются в тестах. Не заявляется реальная кросс-аккаунтная репликация, реальный независимый KMS, 2 human approvals или production RTO/RPO.

## Почему одного S3 SSE-KMS replication недостаточно

Объект source S3 может реплицироваться в другую AWS учётную запись и быть пере-шифрован под destination SSE-KMS. Но в пользовательской metadata зашифрованного R165 архива находится отдельный client-side encrypted data key, изначально обёрнутый source KMS. Репликация S3 metadata не превращает этот зашифрованный ключ в новый ключ destination KMS. Если source KMS полностью отказал, один только ciphertext с destination SSE-KMS может не дать восстановить исходный AES-GCM архив.

R173 заранее выполняет Encrypt того же 32-байтового ключа в destination KMS, подписывает все source/dest bindings и сохраняет вторую encrypted DEK в offsite escrow. При аварии restore требует только destination S3 и destination KMS Decrypt.

AWS: https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-config-for-kms-objects.html

## 1. Offsite S3: сравнение исходного и резервного шифротекста

Код: ops/r173/offsite-object.mjs
Тесты: ops/test/r173.offsite-object.test.mjs

- Два отдельных AWS S3 SDK-клиента, AWS account IDs, AWS regions, KMS ARNs и две независимые версии S3.
- Проверка ExpectedBucketOwner, source replication COMPLETED, destination replication REPLICA, COMPLIANCE retention, distinct SSE-KMS keys, точных object metadata: source commit, bundle, archive, context, key metadata.
- HeadObject/GetObject с ограничением до 25 МБ; реальный SHA-256 пересчитывается по ПОЛНОМУ шифротексту, а не по ненадёжному для multipart ETag.
- Возможно чтение резервной копии с compareSource=false, которое не вызывает source S3 вообще.
- Отказ при wrong KMS/account, подмене байтов, governance retention, недоступном объекте, PENDING/FAILED replication или несогласованном SHA.

AWS: https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-status.html
AWS: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html

## 2. Второй KMS data key envelope и контроль zeroization

Код: ops/r173/offsite-kms.mjs
Тесты: ops/test/r173.offsite-kms.test.mjs

- Официальные AWS SDK v3 EncryptCommand/DecryptCommand под независимо закреплённым destination KMS CMK в другом account/region.
- Источником служит ровно тот же plaintext AES-256 DEK, что шифрует оригинальный PGDMP через R165.
- Контекст r168KmsContext криптографически привязан к commit, bundle, archive-id, scope, project.
- Возвращается только opaque offsite wrapped DEK с SHA-256 и идентичностью двух разных KMS ключей. Plaintext никогда не включается в Git, JSON-отчёт или CI артефакт.
- Временные копии plaintext key zeroized. Caller zeroizes собственный DEK после encryption/decryption.
- В реальном режиме внешняя сеть по умолчанию выключена; в CI проверены настоящие constructors SDK и локальная AES-GCM модель назначения.

## 3. Signed destination S3 escrow с Object Lock COMPLIANCE

Код: ops/r173/offsite-escrow.mjs
Тесты: ops/test/r173.offsite-escrow.test.mjs

- Подписанный Ed25519 manifest связывает source SHA и S3 version, offsite S3 version, оба AWS аккаунта, оба KMS ARN, encrypted DEK SHA, source encrypted DEK SHA, context SHA, PG17 inventory SHA, точный commit и source bundle SHA.
- Публичный ключ проверяется по независимо pinned SPKI SHA-256; изменение подписи, ключа или любого поля отклоняется.
- Отдельный destination PutObject требует IfNoneMatch, SSE-KMS destination, exact ExpectedBucketOwner, versioning и Object Lock COMPLIANCE на минимум 7 дней.
- Версионированный signed receipt читается заново из destination S3 с HEAD/Get, полным SHA-256 и повторной проверкой Ed25519. Исходные S3/KMS для этой операции не требуются.
- TTL signed manifest от 7 до 30 дней, по умолчанию 15 дней. Его нужно обновлять или архивировать при длительном хранении, в противном случае восстановление fail closed.
- Два разных ключа Ed25519 доказывают ключевую независимость, но НЕ двух разных людей.

## 4. Offsite-only recovery: Ed25519, одноразовый SQL и настоящий PG17

Код: ops/r173/offsite-recovery.mjs
Тесты: ops/test/r173.offsite-recovery.test.mjs

- До дешифрования проверяются R164 operator/reviewer dual signatures, source inventory и source bundle, signed escrow receipt, closed quarantine и exact offsite target digest.
- Один durable nonce фиксируется через R171 PostgreSQL one-time audit до обращения к destination KMS Decrypt. Повторный nonce запрещён и SQL детали скрываются в fail-closed обработке.
- Destination S3-only Get возвращает проверенный AES-GCM ciphertext. Source S3 не читается.
- Destination KMS Decrypt возвращает оригинальный 32-byte AES key. R165 openR165Backup строго проверяет GCM tag, commit/bundle, формат native PGDMP и возраст копии.
- PostgreSQL restore разрешён только в disposable database marcosa_r168_restored; независимая проверка сравнивает RLS, sessions, revoked sessions, rows, audit, проверяет отказ повторного nonce.
- Ключ и PGDMP обнуляются в finally после окончания restore. ProductionAuthorized остаётся false.
- Отдельный control PostgreSQL необходим при реальной аварии. В CI он создан как другая тестовая база в том же одноразовом PostgreSQL-кластере — это не географическая независимость.

## 5. Двухэтапная GitHub Actions CI с реальным native pg_dump/pg_restore

Код: ops/r173/ci-acceptance.mjs
Workflow: .github/workflows/marcosa-r173-offsite.yml

- Node 24 + postgres:17-alpine; зафиксирован полный R170 npm lockfile AWS SDK v3 SHA256 29825ad0ccbe541a7328e8293fe6ccde272a17bf26a6960f5d031d6cbd0c1e86, устанавливается npm ci без install scripts.
- 13/13 новых R173 unit tests и 24/24 существующих теста R171–R172.
- Реальный R167/R171 SQL fixture, primary/secondary control PostgreSQL database, one-time nonce, native pg_dump -Fc и отдельный pg_restore.
- Источник шифрует PGDMP client-side AES-256-GCM, destination KMS заново wrap того же ключа, объект с полным SHA передаётся в in-process offsite S3 mock, signed escrow хранится в destination map. Source S3 отключается перед восстановлением.
- Native PG17 восстановлена только из destination ciphertext + destination KMS + signed escrow, с точной проверкой RLS/sessions/audit/nonce.
- Второй GitHub runner без AWS/PG credentials сверяет JSON отчёт и точный R163 source hash. Секреты, PGDMP, ключи, AWS tokens и JWT НЕ публикуются.
- R163 provenance включает ровно 80 source files, включая пять R173 modules. Лимит R162 — 80; для R174 потребуется отдельно расширить лимит с подтверждённой регрессией.

## NO GO и будущий настоящий staging

Не реализовано и не заявляется: реальная GitHub protected environment и независимые human approvals; реальный GitHub OIDC token/STS, AWS IAM role, independent source/offsite AWS accounts, actual cross-account replication, destination Object Lock, actual destination KMS Encrypt/Decrypt, внешняя control DB или проверенный production RPO/RTO.

Для реального staging нужны заранее проверенные IAM/SCP resource policies обеих сторон, бюджет AWS, отдельная защищённая GitHub environment с независимыми approvals и ручной запуск; после этого — отдельное live read-only и затем controlled recovery испытание строго на синтетических данных.

main, публичный сайт, Supabase production, клиенты, платежи и выплаты не изменены.
Все R173 reports: productionAuthorized=false, actualRealAwsAccountsUsed=false, hostedSupabaseChanged=false.
