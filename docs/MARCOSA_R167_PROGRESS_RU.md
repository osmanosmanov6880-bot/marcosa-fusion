# MARCOSA R167 — независимый PostgreSQL 17 restore и защищённый перенос архивов

Дата: 19 ноября 2026 года

Репозиторий: https://github.com/osmanosmanov6880-bot/marcosa-fusion  
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168  
Ветка: feature/marcosa-r150-growth-economics

## Статус и границы доказательств

**Пять функциональных блоков R167 внесены в исходники**. Первый полностью успешный run двух заданий: https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44530636375 — native PostgreSQL 17 encrypted dump на первом GitHub Actions runner, передача зашифрованного артефакта средствами Actions и настоящий pg_restore на ВТОРОМ GitHub Actions runner. Проверки RLS, сессий, карантина, SHA256, X25519, подписи и повреждённых архивов были успешны на том implementation SHA. После этого добавлены более строгий парсер scope, настоящий CA-verified HTTPS тест и расширение source-bundle на код R167 — окончательный статус текущего HEAD нужно смотреть по GitHub Actions.

**Критически важно:** это СИНТЕТИЧЕСКИЙ CI. Тестовый X25519 private key второго runner выводится из публичного Git commit: такой ключ **не обеспечивает секретность**, хотя доказывает корректность протокола X25519/HKDF/AES-GCM, а источник использует лишь публичный ключ получателя. GitHub Actions artifact — внешняя передача файла между изолированными runner, но НЕ сертифицированный offsite backup пользователя, и не KMS. Подпись манифеста временным CI Ed25519 ключом не доказывает, что независимый человек одобрил релиз.

Нет подключения к реальному Supabase, реальному внешнему object store, AWS/GCP/Vault KMS, VPS, публичному домену, личным данным и платежам. Production всегда NO_GO.

## Блок 1. Привязка резервного ключа к конкретному получателю

- Файлы: ops/r167/key-envelope.mjs, ops/test/r167.key-envelope.test.mjs
- X25519 ephemeral-ephemeral ECDH (эпhemeral ключ отправителя, публичный ключ получателя), HKDF SHA256 с контекстом и AES-256-GCM для 32-байтового data key R165.
- Обязательный заранее закреплённый SHA256 SPKI получателя; keyEpoch и minimumKeyEpoch против использования устаревшего ключа.
- Аутентифицированы source commit SHA, bundle SHA256, ciphertext SHA256, recipient fingerprint, срок, IV и версия протокола. Неизвестные поля, production scope, неверная подпись GCM, другой receiver, устаревший epoch/TTL — отказ.
- В обычном интерфейсе приватный ключ получателя остаётся только у получателя, передаётся наружу только wrappedKey. В CI воспроизводимый test key указан явно — ни в коем случае не применять его к настоящим данным.

## Блок 2. Защищённый HTTPS-объектный транспорт

- Файлы: ops/r167/remote-object.mjs, ops/r167/ci-remote-https.mjs, ops/test/r167.remote-object.test.mjs
- Только оператором закреплённый HTTPS origin, hostname, CA, path /v1/archives/[sha].r165enc; rejectUnauthorized=true; минимум TLS1.2, ограничение тела и таймаутов.
- Content-addressed URI, PUT с If-None-Match: *; статус 201 и exact digest/write-once acknowledgement; GET с повторной сверкой полного SHA256 и MIME. Повторная отправка при неизвестном исходе НЕ выполняется (нет ложной exactly-once гарантии).
- Ошибка сертификата, перенаправление, неверный объект/хеш, слабая подпись доступа и недопустимый путь — отказ. Сеть по умолчанию отключена.
- CI поднимает **настоящий локальный HTTPS сервер** с временным сертификатом. Это доказывает сетевое поведение адаптера, НЕ реальную политику immutability коммерческого сервиса. Настоящий внешний object storage пока не подключён.

## Блок 3. Ed25519-манифест передаваемого архива

- Файлы: ops/r167/transfer-manifest.mjs, ops/test/r167.transfer-manifest.test.mjs
- Manifest подписывает точный commit, source bundle hash, envelope hash, recipient SPKI, ciphertext hash/size, bounded TTL и синтетический PostgreSQL security inventory.
- Source Ed25519 public key и его fingerprint передаются второму CI job; второй job сравнивает ожидаемые дайджесты из GitHub Actions needs.outputs и подпись. Неверный signer, commit, key, envelope, устаревшая подпись и поля — отказ.
- Проверка source/target состояния строго сравнивает все безопасные агрегаты и SHA256 синтетических строк; любой RLS/permissions/quarantine/session mismatch — NO_GO.
- Подпись CI не равна независимому человеческому одобрению. Не обещается внешняя supply-chain security после атаки на весь CI workflow.

## Блок 4. Независимый PostgreSQL security witness

- Файлы: tests/postgres/173_r167_synthetic_source.sql, ops/r167/pg-witness.mjs, ops/test/r167.pg-witness.test.mjs
- Создаются только synthetic-учётки и таблицы, с двумя сессиями (одна активна, одна отозвана), тремя записями публичного контента, RLS, тремя audit-записями и карантином closed=true, generation=5.
- Роли anon/authenticated не получают прямой доступ к private; отдельная роль reader NOLOGIN/NOBYPASSRLS имеет ровно SELECT с RLS, но не DELETE audit. Никаких SECURITY DEFINER, пользовательских таблиц или настоящего Auth.
- Отдельный read-only SQL witness строит детерминированный SHA256 содержимого строк и возвращает только безопасные counts/boolean statuses; сверяется с другим экземпляром PG17. Нарушение RLS, снятый карантин, откат события, изменение revision или незапланированные роли — отказ.

## Блок 5. Реальный двухэтапный GitHub Actions workflow

- Файлы: .github/workflows/marcosa-r167-cross-runner.yml, ops/r167/ci-source.mjs, ops/r167/ci-target.mjs.
- **Source job:** совершенно новая одноразовая PostgreSQL 17 (серверная версия проверяется), устанавливает synthetic fixture, получает настоящий pg_dump -Fc через Docker/Postgres, шифрует буфер R165 AES-256-GCM ключом randomBytes(32), заворачивает этот ключ через X25519, подписывает манифест Ed25519 и публикует только ciphertext/envelope/manifest через actions/upload-artifact@v4, retention 1 day. Ключ данных и PEM приватного source-signing key не загружаются.
- **Target job:** совершенно отдельный GitHub hosted runner и вторая чистая PostgreSQL 17. Через actions/download-artifact@v4 получает ciphertext, envelope и manifest. Проверяет source SHA, source bundle воспроизведением исходников, подписанный source Ed25519 proof, job outputs pins и защищённый ciphertext hash.
- Только после всех проверок восстанавливает wrapped data key (PUBLIC CI fixture key), проверяет AES-GCM tag и PostgreSQL native PGDMP, создаёт минимальные NOLOGIN roles и делает настоящий pg_restore в другой PostgreSQL 17.
- Сверяет RLS, session revocation, карантин, audit, все синтетические строки и неразрешённые привилегии; проверяет отказ при другом key epoch, неправильном AES key, изменённом ciphertext и повреждённом pg_dump.
- В artifact результата отправляется только неприватный JSON: separateRunner=true, realPg17Restore=true, syntheticKeyPublic=true, externalKms=false, productionAuthorized=false.
- R163 source-bundle теперь обязателен для всех R167 модулей, и включает повторную побайтовую сверку на независимом runner.

## Production NO_GO

До реального staging требуются независимый аккаунт object storage, удостоверенные immutable retention/permissions, отдельная внешняя KMS/HSM со строгим разделением key material между источником и получателем, OIDC identity-bound access, долговечное хранение зашифрованных бэкапов, проверка запуска настоящего Supabase Auth и data migration, юридически корректная обработка персональных данных, контроль аудиторов и подтверждение бизнеса. Только после отдельного аудита и явного решения владельца возможен production rollout.

Основная ветка main и работающий сайт не изменены.
