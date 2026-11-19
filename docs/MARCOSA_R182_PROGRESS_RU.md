# MARCOSA R182 — IAM / контроль реальных разрешений и измеряемое тестовое восстановление

19 ноября 2026 · PR #168 · feature/marcosa-r150-growth-economics

## Пять реализованных блоков

1. **Две IAM роли и защита OIDC**. Модуль `ops/r182/iam-posture.mjs` в двух разных профилях выполняет `GetRole`, `ListRolePolicies`, `ListAttachedRolePolicies`, `GetRolePolicy`. Проверяет точную роль, доверие к OIDC GitHub staging environment, `sts.amazonaws.com` audience, отсутствие лишних inline/attached policies, ограничение 3600 сек и закреплённую permission boundary. Строго сравнивает с версионированным read-only IAM-планом R178, блокирует неизвестные, пагинированные и расширенные политики. **Содержимое boundary policy отдельно не проверяется; эффективные IAM права и SCP не доказаны**.
2. **Измеряемое восстановление PostgreSQL 17**. `ops/r182/restore-drill.mjs`: точный snapshot R181/R180 с неизменяемым NO-GO, native `pg_dump -Fc`, `pg_restore` в исключительно разрешённую временную `marcosa_r182_drill`, два повторных чтения исходной базы, сверка RLS/карантина и `performance.now` для измерения длительности. Задан тестовый бюджет 120 секунд. `observedFrozenSnapshotLossMs=0` относится только к **замороженному тестовому снимку**, не к production RPO.
3. **Fail-closed объединение доказательств**. `ops/r182/readiness-evidence.mjs`: отдельный SHA источников R181, канонический SHA IAM, неизменяемость состояния до и после проверки, срок действительности IAM, ограничение тестового RTO и подтверждение закрытого карантина. Любая ложная отметка о реальных людях, фактических правах или production RPO/RTO отвергается. Только `NO_GO_INDEPENDENT_ATTESTATION_PENDING`.
4. **PG17 журнал для IAM и теста восстановления**. `tests/postgres/183_r182_no_go_recovery_audit.sql` + `ops/r182/readiness-ledger.mjs`: SERIALIZABLE, NOLOGIN без UPDATE/DELETE, FORCE RLS, id=1, одноразовый runId/nonce, точное соединение с R181 observation + audit и R180 hold; неизменяемый NO-GO + отдельная audit запись. Проверяется запрет чтения веб-ролями, replay и сохранность после ещё одного `pg_dump/pg_restore`.
5. **CI и ручной инструмент реального IAM аудита**. `ops/test/r182.readiness.test.mjs`, `ops/r182/ci-acceptance.mjs`, workflow `marcosa-r182-readiness.yml` — тесты ошибочного trust, attached policy, ослабленной boundary, неизвестных IAM действий, изменений PG/карантина, превышения тестового RTO и replay. Первый runner использует настоящий одноразовый PostgreSQL 17, **синтетические ответы AWS**, два настоящих native восстановлений и полное сравнение SQL. Второй runner без секретов заново вычисляет bundle SHA, хеши IAM/DRILL/NO-GO и все запреты на ложное production GO.

## Ручной read-only запуск AWS IAM

Скрипт `node ops/r182/manual-iam-audit.mjs --read-only` вызывается **только человеком** в reviewed checkout при наличии AWS CLI v2, двух отдельных read-only AWS profiles и параметров `R181_SOURCE_PROFILE`, `R181_OFFSITE_PROFILE`, `R181_SOURCE_ACCOUNT_ID`, `R181_OFFSITE_ACCOUNT_ID`, `R181_SOURCE_REGION`, `R181_OFFSITE_REGION`, `R181_SOURCE_BUCKET`, `R181_OFFSITE_BUCKET`, `R181_SOURCE_KMS_ARN`, `R181_OFFSITE_KMS_ARN`, `R181_SOURCE_COMMIT`, `R181_BUNDLE_SHA256`. Сначала вручную установить `R182_ALLOW_READONLY=YES_NO_DEPLOY`. Роли должны иметь read-only IAM APIs и заранее правильно настроенные OIDC/permissions boundary. CI не выполняет этот скрипт и не получает никаких ключей. Реальных AWS аккаунтов в этом проходе не проверяли.

## Ограничения

MARCOSA R182 не осуществляет staging деплой, merge в `main`, публикацию сайта или снятие карантина. Тестовое PG17 время восстановления нельзя считать фактическим production RTO, а совпадение фиксированного снимка — фактическим RPO. AWS IAM ответы CI синтетические. Нет верификации личности двух реальных reviewers, actual AWS account права, S3 репликации и production приватности. **productionAuthorized=false**. PR остается Draft/без merge до отдельной независимой проверки.

Приёмка только при SUCCESS **обоих** GitHub Actions jobs на одном точном SHA R182.
