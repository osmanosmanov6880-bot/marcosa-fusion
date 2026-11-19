# MARCOSA R174 — контроль актуальности архива, KMS, инцидентов и PostgreSQL 17

Дата: 19 ноября 2026 г.
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
CI: https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r174-readiness.yml

## Рамки доказательств

Реализовано пять блоков R174. Настоящие PostgreSQL 17 и native pg_dump/pg_restore используются только в disposable тесте. Для AWS SDK IAM/KMS/S3 используются официальные классы команд, но ответы провайдеров в CI полностью синтетические. Никаких действительных AWS аккаунтов, production Supabase, пользовательских данных, платежей и production deployments этот релиз не меняет.

Итоговая приёмка должна подтверждаться отдельным GitHub Actions run на конкретном HEAD SHA. Успех R173 на SHA 7b1e51dd2ebd85f0068c5fca80a56364e4969d73 не означает автоматически успех R174.

## 1. Независимый аудит политики destination KMS

Модуль: ops/r174/destination-kms.mjs. Тест: ops/test/r174.destination-kms.test.mjs.

- Read-only AWS SDK v3 DescribeKey, GetKeyPolicy, GetKeyRotationStatus, ListGrants с ограниченными таймаутами.
- Точный ARN, отдельный approved key-policy SHA256, exact staging-role principal, KMS EncryptionContext, запрет kms:DisableKey и kms:ScheduleKeyDeletion, отсутствие unexpected grants и усечённых списков.
- Проверяет customer-managed symmetric key, отсутствие pending deletion, ENABLED, ENCRYPT_DECRYPT, AWS_KMS origin, включённую rotation.
- Принципиально не выдаёт результат за доказательство фактических effective rights/SCP. Действительная KMS policy ещё не установлена и не проверена.

## 2. Monotonic catalog: PostgreSQL 17 RLS + CAS

Файлы: tests/postgres/175_r174_checkpoint.sql, ops/r174/archive-checkpoint.mjs, ops/test/r174.archive-checkpoint.test.mjs.

- Одноразовая PostgreSQL схема r174_ci, таблицы checkpoint и checkpoint_events, роли NOLOGIN NOINHERIT NOBYPASSRLS, FORCE RLS, revoke public/anon/authenticated.
- Требует checkpoint sequence=предыдущий+1 и новый архив не старше предыдущего timestamp. Concurrent stale write, duplicate sequence, missing audit или нарушение формата дают отказ.
- Операции checkpoint и append-only event выполняются одной SQL транзакцией и должны дать exactly 1|1.
- Не является неизменяемым журналом против PostgreSQL superuser. Использовать в production Supabase запрещено; это только лабораторная схема disposable PG17.

## 3. Допуск к восстановлению только актуального архива

Модуль: ops/r174/recovery-admission.mjs, тесты ops/test/r174.recovery-admission.test.mjs.

- Сверяется committed high-water checkpoint, SHA256 encrypted archive, signed Ed25519 escrow, версия, commit/bundle, timestamp и KMS key policy proof.
- Допустимая свежесть архива — задаваемое окно 60 секунд — 24 часа. Если checkpoint сменился во время удалённых проверок, допуск отменяется.
- Любой устаревший, более ранний или подменённый archive/escrow либо ненадёжный KMS policy/grants даёт жёсткий отказ.
- Проверка не заменяет одноразовый durable SQL nonce перед реальным decrypt/restore; результат не даёт production authority.

## 4. Аварийное отключение и проверяемый хешированный журнал

Модуль: ops/r174/offsite-circuit.mjs, тесты ops/test/r174.offsite-circuit.test.mjs.

- Закрыт по умолчанию. Инциденты — только заранее перечисленные error codes: подмена SHA, откат архива, ошибка KMS, устаревшие согласования, ошибка PostgreSQL restore, превышение RTO, попытка повторного nonce.
- Журнал содержит PII-free enum, reason code, hash архива, source commit, timestamp и SHA-256 hash chain. Если durable writer не подтвердил запись, операция не считается успешной.
- Нет автоматического retry/decrypt/production восстановлений. Reset требует two reviewer booleans и совпадения independently pinned checkpoint SHA.
- Два флага не доказывают независимые личности; настоящий human approval всё ещё обязателен. Неизменяемость всей hash chain требует отдельного offsite anchor.

## 5. CI: реальная PG17 и отдельный проверяющий runner

Модуль: ops/r174/ci-acceptance.mjs; workflow: .github/workflows/marcosa-r174-readiness.yml.

- Набор R174 tests + регрессия R173; pin полного AWS SDK transitive dependency graph 3.1170.0 с SHA256 29825ad0ccbe541a7328e8293fe6ccde272a17bf26a6960f5d031d6cbd0c1e86.
- Начинает с реального R173 PG17 source-outage offsite recovery, затем применяет новую SQL схему 175, записывает checkpoint, проверяет race/replay/stale timestamp, аудит и FORCE RLS.
- Официальные KMS SDK read-only классы на синтетических ответах, независимый escrow Ed25519, проверка выбора последнего архива, тест аварийного хешированного журнала.
- Отдельный native pg_dump -Fc и pg_restore в marcosa_r174_restored проверяет, что checkpoint, event и RLS пережили восстановление. Независимый GitHub runner получает только несекретный JSON и пересчитывает bundle SHA.
- R163 список расширен с 80 до 86 файлов и hard-limit 90. SHA256 исходников, symlink и строгий размер продолжают проверяться.

## Ограничения и будущий шаг

Нет реального GitHub OIDC approval, отдельного AWS staging account, живых S3 object versions, independent destination KMS roles/grants, реального cross-account восстановленного дампа, пользовательского production RPO/RTO. Никаких изменений main или публичного сайта. Все productionAuthorized=false.

Следующая задача после успешной CI — независимый staging с утверждёнными операторами и реальными AWS read-only ресурсами; до этого real-cloud NO_GO.
