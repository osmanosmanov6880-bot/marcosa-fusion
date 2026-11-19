# MARCOSA R166 — долговечные доказательства, подпись аудитора и восстановление после перезапуска

Репозиторий: https://github.com/osmanosmanov6880-bot/marcosa-fusion  
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168  
Ветка: feature/marcosa-r150-growth-economics  
Дата: 19 ноября 2026 года.

## Проверенная техническая приёмка

- [R166 изолированная CI-приёмка #44508445018](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44508445018): **SUCCESS, 87/87 тестов R160–R166**; настоящая PostgreSQL 17 с TLS, RLS, приватным журналом событий, созданием AES-256-GCM копии, восстановлением в отдельную базу и проверкой в **новом Node.js процессе**.
- Проверенный implementation commit до расширения source-bundle: `5107f4386616c48a9b98bea2cccdce8cd32a8bad`.
- В конце прохода дополнительно расширена независимая побайтовая source-bundle приёмка R163 на новые обязательные исходники R165/R166. Успешность **последнего** коммита должна оцениваться отдельно по соответствующим GitHub Actions, а не выводиться из предыдущего зелёного запуска.

**Пределы:** все ключи, сертификаты, пользователи, аудиторы, backup и базы в CI синтетические и одноразовые. Две зашифрованные копии записаны в разные приватные каталоги **одного** GitHub runner. Независимый внешний хост, KMS, настоящее хранилище и реальный managed Supabase не использовались. Ни один полученный результат не разрешает production.

## 1. Приватный долговечный PostgreSQL-журнал

Файлы: docs/MARCOSA_R166_AUDIT_PG17_REFERENCE.sql, ops/r166/audit-chain.mjs, ops/test/r166.audit-chain.test.mjs.

- В private schema две таблицы: r166_audit_head и r166_audit_events, RLS включён.
- Ограниченные роли marcosa_r166_audit_writer и marcosa_r166_audit_reader созданы как NOLOGIN/NOBYPASSRLS. Browser roles `anon` и `authenticated` не получают SELECT. Writer не имеет UPDATE/DELETE на события.
- Только фиксированные, неперсональные категории и результаты; невозможно добавить email, IP, пользовательский текст, JWT или произвольный JSON.
- Каждая транзакция сериализует единственную строку head через SELECT ... FOR UPDATE, затем атомарно INSERT события, UPDATE seq+SHA256 head и COMMIT. При ошибке — ROLLBACK.
- Функция проверки повторно пересчитывает всю ограниченную последовательность до 256 событий и сравнивает с независимо переданным hash-head. Без внешнего закрепления head это tamper-evident журнал, **не** настоящий неизменяемый audit log.

## 2. Отдельная Ed25519 подпись контрольных доказательств

Файлы: ops/r166/signed-anchor.mjs, ops/test/r166.signed-anchor.test.mjs.

- Подписываются source commit, bundleSha256, ciphertextSha256, auditHead, auditSeq, generation закрытого карантина, nonce и время действия максимум 10 минут.
- Для подписи требуется внешне предоставленный Ed25519 private KeyObject/PEM; ключ НЕ генерируется модулем, не записывается в отчет и не экспортируется.
- Проверка принимает только заранее independently pinned SPKI SHA256 ключа аудитора. Неверная подпись, истёкшее окно, подмена исходников, архива, головы журнала и лишние поля — отказ.
- CI выпускает временную пару ключей в раннере, поэтому distinct key != реальное независимое лицо, humanIndependenceEstablished=false. Production authorization всегда false.

## 3. Атомарное хранение зашифрованного архива

Файлы: ops/r166/evidence-vault.mjs, ops/test/r166.evidence-vault.test.mjs.

- Хранилище требует абсолютный canonical root, приватные права, отсутствие symlink, владельца текущего процесса.
- Принимаются только R165 AES-256-GCM ciphertext envelopes, без plaintext dump. Содержимое записывается во временный exclusive файл (0600), синхронизируется fsync и публикуется по SHA256 адресу через hard-link без перезаписи существующего объекта.
- Перед чтением сверяются lstat, O_NOFOLLOW, inode, size, nlink=1, permissions и SHA-256 шифротекста. Подмена, world-readable каталог, неправильный digest и повторная запись отвергаются.
- Тест переносит ciphertext во второй независимый **локальный каталог того же runner** и выполняет readback. Это не доказательство физически независимого узла, offsite encryption vault или реального облачного бэкапа.

## 4. Свежее Node-процессное подтверждение после restart

Файлы: ops/r166/restart-verifier.mjs, ops/test/r166.restart-verifier.test.mjs, ops/r166/ci-stage2.mjs.

- Новый процесс с новыми PostgreSQL подключениями проверяет подпись аудита с отдельным pinned public SPKI и повторно считывает head/events из реальной БД.
- Ранее использованный R165 подписанный двумя ключами nonce подаётся ещё раз; допускается **только** SQL отказ об уже использованном nonce.
- Затем читается durable quarantine generation: closed=true и generation должны быть теми же. Следующая SQL-модификация с действительным синтетическим auth.session должна быть отклонена как карантинизированная.
- Вновь читается зашифрованный blob из второго каталога, проверяются его SHA-256, AES-GCM tag, source commit/bundle и срок, plaintext никогда не записывается и затирается в буфере после проверки.
- Успех означает `postRestartNonceReplayRejected`, `quarantinePersistedClosed`, `auditHeadAnchored`; все флаги authorization/deployment/payouts остаются false.

## 5. Полный PG17 CI и расширенная воспроизводимость исходников

Файлы: ops/r166/ci-stage1.mjs, ops/r166/ci-stage2.mjs, .github/workflows/marcosa-r160-staging.yml; обновлены ops/r162/release-evidence.mjs, ops/r163/repro-bundle.mjs и .github/workflows/marcosa-r163-release.yml.

- Продолжает **все** предыдущие R160–R165 проверки с настоящей PostgreSQL 17 и TLS, session revocation, RLS, signed HTTP, webhook inbox, disaster recovery и fail-closed gate.
- R166 инициализирует отдельные NOLOGIN роли и private audit tables, записывает три последовательных события и проверяет hash chain.
- Дополнительно расходует новый подписанный R165 nonce, берёт реальный PG17 custom dump, шифрует AES-256-GCM, пишет ciphertext в два приватных каталога и восстанавливает источник в `marcosa_r166_restored`. Исходные и восстановленные агрегаты (RLS, аудит, nonce, карантин, количество команд и сессий) должны совпасть.
- Временный ключ только в приватном 0600 файле GitHub runner, не попадает в GitHub Actions artifacts; после отдельного процесса и проверок файл удаляется.
- Второй Node процесс подтверждает подписи, привязку архива, повтор nonce и закрытый карантин.
- Независимая R163 source-bundle проверка теперь включает обязательные модули R165 и R166, список ограничен 64 исходниками; его повторное построение выполняется на другом CI runner с тем же Git commit. Это проверка байтов исходников, **не** независимое человеческое разрешение на публикацию.
- В GitHub artifacts загружается исключительно неперсональный, не содержащий ключей/дампов отчет `r166-safe-evidence-report.json` с ограниченным retention.

## Остающиеся NO_GO

Отсутствуют: настоящий managed Supabase staging project и подтверждение прав живых auth.sessions, внешний HTTPS/staging DNS, KMS или vault с внепроцессной долговечной выдачей ключей, offsite encrypted archive и восстановление в другом физическом окружении, human-reviewed signing key ownership, real user consent/notification provider, authorization для коммерческого запуска, реальные платежи и выплаты.

Рабочая ветка `main`, публичный сайт и production не изменены.
