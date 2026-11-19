# MARCOSA R165 — долговечный запрет повторов, карантин записи и шифрованное восстановление

Репозиторий: https://github.com/osmanosmanov6880-bot/marcosa-fusion
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
Ветка: feature/marcosa-r150-growth-economics
Статус: реализовано в коде. CI приёмка PostgreSQL 17 выполняется по workflow .github/workflows/marcosa-r160-staging.yml; актуальное заключение проверяется по GitHub Actions head SHA.

## Пять полноценных инженерных блоков

### 1. PostgreSQL-учёт использованных Ed25519-разрешений

Файлы: docs/MARCOSA_R165_PG17_FENCES_REFERENCE.sql, ops/r165/durable-quorum.mjs, ops/test/r165.durable-quorum.test.mjs.

- PostgreSQL r165_drill_nonces с PRIMARY KEY nonce, SHA коммита, digest target, scope staging-rehearsal-only и timestamp.
- RLS, ограниченный NOLOGIN/NOBYPASSRLS writer и явные SELECT/INSERT, без DELETE/UPDATE для writer, запрет доступа browser.
- Перед INSERT в единственной транзакции проверяются обе Ed25519 подписи R164, pinned key fingerprints, source SHA, срок и synthetic scope. INSERT ... ON CONFLICT DO NOTHING RETURNING nonce разрешает только одно применение по всей PostgreSQL, а не только в одной памяти Node.
- Два независимых concurrent клиента PostgreSQL конкурируют за один nonce — ровно один должен успешно зафиксировать разрешение.
- Не подтверждает разные реальные личности владельцев ключей и не даёт права на production.

### 2. Однонаправленный карантин на SQL-уровне

Файлы: docs/MARCOSA_R165_PG17_FENCES_REFERENCE.sql, ops/r165/quarantine-gate.mjs, ops/test/r165.quarantine-gate.test.mjs; обновлён ops/r161/session-fenced-store.mjs.

- Состояние r165_quarantine по умолчанию closed=true, persistent generation>=1, время изменения, RLS и отдельные NOLOGIN роли reader/closer.
- Непривилегированный оператор может **закрывать**, но не имеет SQL разрешения открыть карантин. Для воспроизводимого CI только отдельный суперпользователь одноразовой БД переводит closed=false.
- В trusted store r161 две проверки (до редакторской команды и перед COMMIT) дополнены SELECT состояния карантина в **той же** транзакции.
- SQL недоступен, запись отсутствует или карантин закрыт -> отказ 503 и ROLLBACK. Нельзя обойти закрытие через устаревший HTTP/JWT или два процесса.
- Generation монотонен, а reopening после CI не является автоматической функцией продукта.

### 3. AES-256-GCM архив PostgreSQL с защитой от подмены

Файлы: ops/r165/encrypted-backup.mjs, ops/test/r165.encrypted-backup.test.mjs.

- Настоящий pg_dump custom buffer шифруется AES-256-GCM со случайным 96-битным IV и внешним 256-битным ключом, без записи ключа в код, GitHub artifact или лог.
- Аутентифицированные метаданные (AAD) включают полный source commit SHA, bundleSha256, sourceDb=postgres, synthetic-only scope, временную отметку и SHA-256 plaintext.
- Расшифровка возвращает точные байты только после проверки GCM authentication tag, исходной версии, срока, длины, размера и SHA-256.
- Неверный ключ, повреждённый ciphertext, изменённые метаданные и другой commit отвергаются.
- Не реализован реальный KMS и самостоятельная отправка резервных копий во внешнее хранилище.

### 4. Независимая сверка восстановленной базы и прав доступа

Файлы: ops/r165/recovery-verifier.mjs, ops/test/r165.recovery-verifier.test.mjs.

- Из исходной и отдельно восстановленной PostgreSQL снимаются строгие агрегаты без персональных идентификаторов: editor revision, число одобренных SQL-команд, nonceCount, closed/generation, inbox unique/acknowledgements, живые и отозванные сессии, RLS и запрет чтения browser.
- Результат для источника и восстановленной БД должен совпасть байт-в-байт. Проверяются именно важные значения, а не только равенство двух сломанных БД.
- Нужны независимая БД marcosa_r165_restored, измеренный интервал, а также отрицательные доказательства неверного ключа, изменения ciphertext и порчи PG backup.
- Любое несоответствие -> отказ. Успешная лабораторная проверка всегда productionAuthorized=false и realOffsiteRestoreVerified=false.

### 5. GitHub Actions: одновременные операции и настоящий encrypted DR

Файлы: ops/r165/ci-acceptance.mjs, .github/workflows/marcosa-r160-staging.yml.

После успешной R160–R164 лабораторной проверки:
1. Устанавливается новая RLS схема R165 в отдельной PostgreSQL 17-alpine, создаются строго отдельные роли (не расширяются browser permissions).
2. Сначала закрытый по умолчанию карантин отвергает редакторскую команду. Затем суперпользователь CI временно открывает карантин для одного успешного изменения revision 2→3.
3. Узкая роль closer закрывает карантин (generation 3); последующий запрос неизменно запрещён. Рабочая запись и журнал idempotency не меняются.
4. Две независимые SQL-транзакции одновременно проверяют один подписанный двумя временными ключами nonce; обе подписи действительны, одна транзакция выигрывает, другая отклоняется.
5. Создаётся настоящий PostgreSQL custom dump, шифруется AES-256-GCM, записывается на диск как ciphertext, вновь читается и проверяется SHA256. Неправильный ключ и повреждённый архив отклоняются.
6. После расшифрования в память архив восстанавливается в **новую** marcosa_r165_restored. Сверяются источник и copy, RLS, сессии, nonce, поколение карантина и запланированные изменения. Зашифрованная копия удаляется в finally.
7. В артефакт GitHub Actions сохраняется только неперсональный JSON результат, **не** секрет, дамп или зашифрованная копия.

## Граница доказательств

CI на одноразовой PostgreSQL подтверждает корректность дизайна и защитных проверок в том окружении. НЕ подключены managed Supabase, реальное staging DNS/SSL, credential vault/KMS, offsite backup, личная независимость одобривших лиц, реальные уведомления и коммерческий production. Настоящие платежи и выплаты также остаются NO_GO.

Следующее необходимое действие — независимый staging/security review с внешним хранилищем ключей и данных. Без этого принятие результата CI не является разрешением на deployment.
