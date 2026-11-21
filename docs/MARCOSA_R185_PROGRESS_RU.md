# MARCOSA R185 — диагностический пакет staging, репетиция canary и безопасные доказательства

20 ноября 2026 · PR #168 · `feature/marcosa-r150-growth-economics`

## Пять крупных реализованных направлений

1. **Чек-лист фактической готовности к staging**: `ops/r185/readiness-intake.mjs` принимает строго четыре типа read-only свидетельств (AWS identity/S3, IAM boundary/deny, GitHub Environment, GitHub PR reviews), классифицирует `CI_SYNTHETIC` или `OPERATOR_READONLY_UNATTESTED`, защищает от повышения источника до реальной provider attestation и требует closed quarantine и точный source SHA. Возвращает 5 практических блокеров: реальные независимые согласования людей, фактические IAM/SCP/KMS права, ingress/остановку staging, приватность, подтверждённые RPO/RTO. Секреты из внешних ответов не переносятся.
2. **Репетиция canary и отката без публикации**: `ops/r185/pilot-rehearsal.mjs` проверяет четыре окна SHADOW/CANARY_1/5/10 с порогами error budget и p95. Пять режимов: NORMAL, error spike, latency spike, manual stop, changed source. При любом нарушении выполняется **симулированный** stop → rollback с SHA-256 цепочкой событий. Программное состояние не содержит сетевого деплоя, реального переключения маршрутов или выхода из quarantine. Успешный тест всё равно возвращает `NO_GO_REHEARSAL_COMPLETED`.
3. **Безопасный воспроизводимый evidence export**: `ops/r185/safe-evidence.mjs` создаёт канонический JSON не более 4 КБ только из белого списка полей; исключает исходные ответы провайдеров, персональные данные, пароли, токены и ключи. Встроены запрет неизвестных ключей, поиск секретов, двойная проверка digest, проверка неканонического JSON и отдельный SHA файла. Это hash integrity, **не** независимая цифровая подпись или доверие провайдеру.
4. **Одноразовая запись в реальном PostgreSQL17**: `ops/r185/pilot-gate.mjs` проверяет цепочку R184, реальное чтение hold + audit, закрытый карантин до/после оценки, привязанные SHA intake/rehearsal/portable evidence и пять блокеров. `ops/r185/hold-ledger.mjs` + `tests/postgres/186_r185_actionable_hold.sql`: SERIALIZABLE, NOLOGIN, FORCE RLS, только INSERT/SELECT, одна запись `NO_GO_STAGING_BLOCKERS_UNRESOLVED`, отдельная audit запись, запрет replay. Процесс не имеет ветки разрешения real pilot.
5. **CI / аварийные тесты**: `ops/test/r185.preflight.test.mjs` покрывает просроченные/подменённые evidence, отказ canary, вмешательство в карантин, попытку GO/экспорта секрета и replay. `ops/r185/ci-acceptance.mjs` объединяет настоящий одноразовый PG17, native `pg_dump -Fc/pg_restore`, R184 hold и safe artifact, блокировку повтора. Отдельный runner **без PG и AWS credentials** перепроверяет точные source hashes, канонический файл и отсутствие ложного GO.

Контрольный манифест: **160 исходных файлов**, полный коммит проверяется при каждом CI. `main`, реальная staging-среда, публичный сайт, клиентские данные и платежи неизменны.

## Границы и следующий практический шаг

CI использует **синтетические ответы GitHub/AWS** и синтетические canary-метрики. Настоящий PostgreSQL17 изолирован в disposable runner. Реальное состояние PR reviews, GitHub Environment, AWS IAM/ST​S, независимость человеческих согласований и production RPO/RTO не подтверждаются этими тестами. Приёмка R185: только **2 SUCCESS jobs на одном полном SHA**.

Оператор может получить [JSON](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions) после CI, затем отдельно, при наличии законных read-only полномочий, проверить перечисленные блокирующие факторы. **realPilotAuthorized=false, productionAuthorized=false**.
