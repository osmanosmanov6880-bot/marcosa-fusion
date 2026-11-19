# MARCOSA R169 — GitHub OIDC, настоящий AWS SDK v3 и управляемая приёмка staging

Дата: 19 ноября 2026 года

**Репозиторий:** https://github.com/osmanosmanov6880-bot/marcosa-fusion  
**PR:** https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168  
**Ветка:** feature/marcosa-r150-growth-economics

## Статус

Пять больших блоков реализованы непосредственно в исходниках и тестах. Изолированный GitHub Actions workflow \`.github/workflows/marcosa-r169-cloud.yml\` запускает реальные published классы AWS SDK v3, полный R169 регрессионный набор и настоящий PostgreSQL 17 dump/restore с синтетическими AWS-клиентами. Второй runner проверяет исходники и неперсональный отчёт. Актуальное заключение смотрите по GitHub Actions для точного SHA последнего коммита; успешность ранее запущенных CI на другом SHA не доказывает текущий.

**Никаких реальных вызовов AWS не совершено.** Настоящие AWS учётные данные не подключены, нет разрешения \`id-token: write\` в CI. OIDC trust, IAM policies и S3/KMS конфигурация существуют как **проверяемые проекты и адаптеры**, не как применённые облачные ресурсы. Реальная платформа Supabase, публичный сайт, базы пользователей, платежи и выплаты не изменены.

## Пять реализованных блоков

### 1. Пара GitHub OIDC / IAM least privilege

Код: \`ops/r169/iam-plan.mjs\`, \`ops/test/r169.iam-plan.test.mjs\`.

- Генерирует точный trust policy для **одной** feature ветки репозитория \`osmanosmanov6880-bot/marcosa-fusion\`. Два поддерживаемых режима OIDC sub: legacy \`repo:owner/repo:ref:refs/heads/...\` и immutable \`repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:...\`. Для immutable нужны реальные owner/repo IDs (зафиксировано: owner 340648536, repo 1430301644).
- Формат sub нужно подтвердить у конкретного GitHub OIDC provider; пользователь должен выбрать и зафиксировать фактически выпускаемый claim. Сам генератор не переключает GitHub repository subject format.
- IAM scoped к одному AWS account, region, bucket prefix \`marcosa/isolated/r168/*\`, конкретному KMS key ARN. Нет wildcard Resource, wildcard actions и доступа к продакшену.
- Минимальные права позволяют предшествующую read-only конфигурационную проверку S3/KMS и scoped KMS GenerateDataKey/Decrypt только при EncryptionContext \`isolated-staging-only\`.
- Явные Deny запрещают удалять объекты/версии, обходить retention, менять bucket security/ACL/Object Lock и уничтожать/переписывать KMS key policy.
- Trust/permissions JSON возвращаются как **read-only plan**, не отправляются в IAM. Это не эквивалент полного AWS IAM/SCP audit.

### 2. Настоящий AWS SDK v3 bootstrap и временные STS

Код: \`ops/r169/aws-runtime.mjs\`, \`ops/r169/package.json\`, \`ops/test/r169.aws-runtime.test.mjs\`, \`ops/r169/ci-native-sdk.mjs\`.

- Подключены реальные импорты AWS SDK \`@aws-sdk/client-kms\`, \`@aws-sdk/client-s3\`, \`@aws-sdk/client-sts\`. Манифест требует точные top-level версии \`3.1170.0\` без диапазонов, Node.js 24.
- Клиенты конструируются с explicit \`region\`, pinned account/KMS ARN, \`maxAttempts=1\` и **внедрённым** credential provider. Не используются endpoint overrides или ambient EC2/container/profile credential chain.
- В режиме реального доступа необходимо \`GITHUB_ACTIONS=true\`, точный repo/ref, только workflow_dispatch, staging-only flag, обязательный operator opt-in, \`AWS_EC2_METADATA_DISABLED=true\` и отсутствие статических профилей/конфигурационных переопределений.
- Проверяются только session credentials с \`ASIA...\` temporary access key ID, sessionToken и явным \`expiration\` в пределах 2–60 минут. Проверка этих полей сама по себе не подтверждает корректность подписи GitHub OIDC — это делает AWS STS/IAM на реальном provider.
- При отсутствии разрешения реальные обращения к AWS заблокированы и не запрашиваются облачные креденшалы. Клиенты закрываются через \`destroy\`.
- CI устанавливает опубликованные библиотеки с \`npm install --package-lock-only\`, затем \`npm ci --ignore-scripts\`; проверяет действительные конструкторы/команды без сетевых вызовов. **Пока lockfile собирается в изолированном CI и сохраняется как артефакт**, он ещё не утверждён как постоянный репозиторный lock. Это остаётся блокирующим шагом до коммерческого развёртывания.

### 3. Независимая read-only инспекция AWS S3/KMS

Код: \`ops/r169/cloud-posture.mjs\`, \`ops/test/r169.cloud-posture.test.mjs\`.

- Встраивается в существующий R168 preflight и добавляет SDK v3 GetBucketPolicy, GetBucketEncryption, GetBucketOwnershipControls, GetKeyPolicy.
- Требует не-публичный bucket policy с явным запретом HTTP TLS-off requests; включённое \`BucketOwnerEnforced\`, ровно SSE-KMS default с точным ARN; key policy выдаёт staged роли GenerateDataKey/Decrypt строго при isolаted-staging EncryptionContext.
- Отвергает публичные Allow principals, сторонние AWS аккаунты, KMS без контекстных условий, плохой регион/ключ, отключённый owner enforced и ошибки API.
- Результат действителен лишь 60 секунд, всегда \`effectiveScpPermissionsAudited=false\`, \`productionAuthorized=false\`.
- Статическая проверка S3/KMS JSON политик недостаточна для формального доказательства фактических IAM и Organizations SCP effective permissions; до реального запуска нужен отдельный ручной/автоматический cloud audit.

### 4. Двухподписной допуск к изолированному recovery

Код: \`ops/r169/staging-rehearsal.mjs\`, \`ops/test/r169.staging-rehearsal.test.mjs\`.

- До первой внешней операции проверяет manual-only GitHub runner, exact IAM plan, два Ed25519 signature с независимо pinned public keys R164, ожидаемый source/role/inventory digest, закрытый PostgreSQL карантин, свежий STS/KMS/S3 preflight и read-only cloud posture.
- Требует подтверждение **одноразового** PostgreSQL nonce от R165 durable-quorum. Если допуск уже использован, никакие KMS/S3 операции не происходят.
- После допуска вызывает R168 \`backup\` и \`rehearseRecovery\`, разрешает восстановление **только** в \`marcosa_r168_restored\`, сверяет RLS/сессии/карантин и проверяет закрытый карантин снова.
- В случае сбоя не пытается переиспользовать nonce или автоматически повторить неизвестный результат S3-записи. Success никогда не выдаёт production grant.
- В unit и новом R169 PG17 CI использован **симулированный** nonce-consumer. Реальный PostgreSQL одноразовый nonce отдельно испытан в R165 CI. Нельзя трактовать новый R169 CI как самостоятельный повторный тест R165 долговечной транзакции. Два разных криптографических ключа в CI не доказывают двух независимых людей.

### 5. Настоящий PostgreSQL17, точные классы SDK v3, CI и независимое свидетельство

Код: \`ops/r169/ci-acceptance.mjs\`, \`ops/r169/ci-native-sdk.mjs\`, \`ops/r169/ci-verify-report.mjs\`, \`.github/workflows/marcosa-r169-cloud.yml\`.

- GitHub CI запускается с **только \`contents: read\`**, без GitHub ID token, AWS cloud env secrets и OIDC provider grants.
- Выполняет установку и smoke настоящих AWS SDK v3 классов \`KMSClient\`, \`S3Client\`, \`STSClient\` без сетевых вызовов.
- Создаёт изолированную PG17 с синтетическими private sessions, private RLS, активной и отозванной сессией, closed quarantine, audit и тремя публикациями.
- Получает реальный \`pg_dump -Fc\`, передаёт буфер через предыдущий R168 AWS-shaped AES-GCM KMS/S3 mock и восстанавливает настоящим \`pg_restore\` в новую PostgreSQL 17 БД.
- Входной staging-режим строго симулирован в CI: не выдаётся реальный workflow_dispatch/OIDC token. Две тестовые Ed25519 подписи и один fake nonce проверяют маршрут R169; повторное использование подписанного nonce должно завершиться отказом.
- Второй runner с нулевыми AWS/PG credentials получает только безопасный отчёт, проверяет все поля и source SHA. Другой R163 независимый source workflow расширен на все исходники R169, включая mанифест пакета.
- Любые реальные AWS account, KMS provider, S3 object storage, Supabase project и production остаются NO_GO.

## Предпосылки реального AWS staging

Не подключать production до выполнения следующих условий: утвердить отдельный AWS account/region и бюджет, создать versioned COMPLIANCE S3 и symmetric KMS, отдельно подтвердить GitHub OIDC sub формат (после обновлений GitHub 2026), развернуть роли с ограниченными ветками и без wildcard, проверить эффективные IAM/SCP и KMS key policy на живом облаке, закрепить/закоммитить транзитивные зависимости AWS SDK по проверенному lockfile, затем провести отдельное согласованное реальное staging-испытание с синтетическими данными и восстановлением в другую базу. Подписанные production approvals и реальный offsite backup ещё не существуют.

**Любой отчёт R169: \`productionAuthorized=false\`, \`liveSupabaseConnected=false\`, \`realAwsServiceAccessAudited=false\`.**
