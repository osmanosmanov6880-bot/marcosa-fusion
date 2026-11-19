# MARCOSA R168 — интерфейсы реальных AWS KMS/S3, безопасный backup и PG17 disaster recovery

19 ноября 2026 года

Repo: https://github.com/osmanosmanov6880-bot/marcosa-fusion  
PR #168: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168  
Branch: feature/marcosa-r150-growth-economics

## Статус

Пять блоков R168 внесены в код и интегрированы в отдельный GitHub Actions workflow. Проверка R168 на одноразовой PostgreSQL 17 успешно выполнила **10/10 модульных тестов**, настоящий native \`pg_dump -Fc\` → KMS/S3 SDK-v3-shaped staging adapters → native \`pg_restore\` в независимую тестовую БД, сверку синтетических строк/RLS/Auth/quarantine и отрицательные сценарии безопасности: [R168 CI run #44534852940](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44534852940).

Вторая задача этого workflow повторно хеширует исходники и проверяет отчёт на отдельном GitHub runner. Полный статус **последнего** коммита смотрите в GitHub Actions, он может отличаться после правок документации.

**Абсолютная граница доказательств:** реальные подключения к AWS KMS, S3, STS и IAM не выполнялись. Конструкторы команд AWS SDK v3 и метод \`send\` инжектируются извне, в CI используется криптографический, но полностью локальный mock. Права, безопасность реального AWS KMS, S3 Object Lock и коммерческих резервных копий не подтверждены; нельзя утверждать, что это production-ready. Для настоящего применения нужно отдельно установить и закрепить версии @aws-sdk/client-kms, @aws-sdk/client-s3 и @aws-sdk/client-sts, передать SDK v3 clients с OIDC/STS учётными данными и выполнить независимый инфраструктурный/security review. Никаких постоянных ключей или паролей в исходниках нет.

## 1. AWS KMS — ключи данных без собственного ключевого сервера

Files: \`ops/r168/aws-kms.mjs\`, \`ops/test/r168.aws-kms.test.mjs\`.

- Принимает внедрённые SDK v3 KMSClient, GenerateDataKeyCommand и DecryptCommand; не встраивает секреты и не изобретает свой API AWS.
- Разрешает только конкретный ARN симметричного ключа KMS с совпадающими accountId/region; нет wildcard, alias без пина и выбора произвольного KMS ключа из запроса.
- При GenerateDataKey задаётся AES_256 и EncryptionContext: проект, isolated-staging-only, версия протокола, SHA40 commit, SHA64 исходников и hex32 archiveId. Контекст фиксированный и не содержит PII.
- Выход KMS должен вернуть 32-байтовый ключ, ограниченный opaque CiphertextBlob и точный ARN ключа. Исходный буфер SDK стирается, копия применяется только к шифрованию и стирается в finally.
- Decrypt всегда передаёт exact KeyId и такой же authenticated EncryptionContext. Несовпадение контекста, ARN, длины или ошибки KMS -> fail closed.
- Отсутствие явного \`allowExternalCalls=true\` блокирует сетевые операции. Само включение opt-in ещё не означает production approval.

AWS reference: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/kms/ — GenerateDataKey, Decrypt, EncryptionContext.

## 2. Versioned write-once S3 object storage

Files: \`ops/r168/aws-s3.mjs\`, \`ops/test/r168.aws-s3.test.mjs\`.

- Инъекция настоящих SDK v3 PutObjectCommand, HeadObjectCommand и GetObjectCommand. Фиксированные accountId, region, bucket и KMS key ARN. Только ciphertext R165 AES-256-GCM, без plaintext dump.
- Content-addressed key \`marcosa/isolated/r168/{sha256}.r165enc\`; conditional PutObject \`IfNoneMatch='*'\`; нет автоматических прикладных retries при неизвестном исходе записи.
- PutObject требует SSE-KMS с точным KMS key ARN, checksum SHA256 в base64, ObjectLockMode=COMPLIANCE и RetainUntilDate от 7 до 30 дней. Это операции реального AWS SDK, **но аккаунт CI не задействован**.
- После записи адаптер требует VersionId и повторно вызывает HeadObject для той же версии. Проверяет retention, ContentLength, checksum, content-type, SSE-KMS, точные metadata полей и аккаунт.
- В S3 metadata хранится только **зашифрованный KMS data key** и неперсональные обязательные SHA/архив/контекст; размер ограничен, нет паролей, plaintext DEK или JWT.
- GetObject с точной версией возвращает ограниченный поток, заново проверяет его SHA256 и magic R165. Не доверяет одному ETag и не принимает GOVЕRNANCE вместо COMPLIANCE.
- Принятие ответа mocked API не доказывает, что настоящий AWS бакет защищён от root/account level changes. Требуется внешняя инспекция IAM/SCP/Object Lock политики.

AWS reference: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html.

## 3. Безопасный предварительный допуск AWS инфраструктуры

Files: \`ops/r168/aws-preflight.mjs\`, \`ops/test/r168.aws-preflight.test.mjs\`.

- STS GetCallerIdentity: exact AWS Account + ограниченный ARN assumed-role \`marcosa-staging-backup-role\`. Это проверка AWS role identity, **не доказательство, что credential получен именно через OIDC**.
- KMS DescribeKey: exact ARN, Account ID, KeyState Enabled, KeyUsage ENCRYPT_DECRYPT, KeySpec SYMMETRIC_DEFAULT.
- S3 GetBucketLocation, GetBucketVersioning, GetObjectLockConfiguration, GetPublicAccessBlock: регион совпадает, Versioning Enabled, default ObjectLock COMPLIANCE, все 4 запрета публичного доступа true.
- Любая ошибка сети, прав, конфигурации или устаревшая 60-секундная lease блокирует backup и restore. Без preflight разрешения процесс не выполняет загрузку.
- Логическое подтверждение endpoint/provider из mocked ответа **не** равно независимому security audit реального cloud account.

## 4. Сквозной модуль резервного копирования и восстановления

Files: \`ops/r168/backup-pipeline.mjs\`, \`ops/test/r168.backup-pipeline.test.mjs\`.

- Backup принимает только нативный PGDMP и строгий synthetic R167 non-PII inventory; проверяет контекст и допуск STS/KMS/S3.
- Получает data key из KMS, шифрует native PostgreSQL custom dump существующим R165 AES-GCM, записывает зашифрованный архив через S3 COMPLIANCE/conditional Put, сверяет Head/version/checksum и возвращает не секретный source-bound reference.
- Restore перед запросом к облаку проверяет криптографические SHA reference, самостоятельно закреплённый digest source inventory и свежий IAM preflight.
- Загружает только запрошенную неизменяемую S3 version; проверяет SHA и metadata; KMS Decrypt получает тот же EncryptionContext; AES-GCM проверяет tag и исходные commit+bundle.
- \`pg_restore\` получает проверенный plaintext через **только** callback для фиксированной базы \`marcosa_r168_restored\`. Затем отдельный SQL witness сверяет строки, RLS, Auth и карантин. Buffer plaintext/DEK стираются после завершения.
- Новый модуль не создаёт remote connection из воздуха и не даёт разрешения писать в реальные базы Supabase.

## 5. Настоящий PostgreSQL 17 и независимая CI-проверка

Files: \`ops/r168/mock-aws.mjs\`, \`ops/r168/ci-real-pg.mjs\`, \`ops/r168/ci-verify-report.mjs\`, \`.github/workflows/marcosa-r168-provider.yml\`, \`ops/test/r168.mock-aws.test.mjs\`.

- GitHub job проверяет HEAD SHA, disposable PG17, запускает **все** модульные тесты R168.
- Создаёт R167 синтетическую PostgreSQL fixture с пользователями/ролями, RLS, одной активной и одной отозванной сессией, карантином closed, аудиторским журналом.
- Получает **настоящий pg_dump из postgres:17-alpine**, обрабатывает его через точные формы команд KMSClient/S3Client/STSClient. Локальный тестовый KMS использует настоящую AES-GCM с временным ключом, mock S3 имитирует условные записи, версии и Object Lock. Это контрактное тестирование SDK, а не реальные запросы в AWS.
- Восстанавливает native PostgreSQL custom archive в новую \`marcosa_r168_restored\`, затем независимо считывает и сравнивает полный non-PII inventory, включая SHA строк и роли RLS.
- Негативные сценарии: default Object Lock downgraded to GOVERNANCE, публичный S3 policy, повреждённый ciphertext, KMS Decrypt outage — для каждого требуется отказ без выдачи production success.
- Второй GitHub Actions runner скачивает **только безопасный JSON-отчёт**, повторно хеширует полный R163 bundle исходников текущего SHA и отвергает любые поля, заявляющие real AWS, production, аудит KMS, активные платежи.
- R163 теперь включает все файлы R168, а его отдельный независимый source replay запускается при каждом изменении R168.

## Что осталось до реального staging

Нужны все перечисленные предпосылки:
1. Владелец утверждает **изолированные AWS accountId/region, S3 bucket, конкретный KMS key ARN и IAM роли**. Это должна быть непубличная тестовая среда с доступами по принципу наименьших привилегий. Доступы и расходы не подразумеваются.
2. Создать и проверить S3 versioned Object Lock bucket с COMPLIANCE retention, bucket policy, Block Public Access и ExpectedBucketOwner; настроить OIDC assumable IAM role с условиями repo/ref/workflow и обязательными permissions boundary.
3. Установить закреплённые AWS SDK v3 packages и инициализировать реальные KMSClient/S3Client/STSClient через доверенный credential provider. Потребуются негативные проверки IAM и запрет неожиданных endpoint overrides.
4. Проверить реальную выдачу/расшифровку ключа в AWS KMS, условную запись/Lock/GET объекта в S3 и восстановление исключительно **одноразового тестового PG17 backup**, с независимым security review.
5. После отдельного human signoff — резервное копирование в независимый регион/аккаунт с продуманным retention, мониторингом, ротацией KMS и disaster recovery планом. Без подписанного операционного допуска никакого production, оплаты и выплаты авторам.

**R168 productionAuthorized=false, realAwsAccountVerified=false, realKmsConnected=false. Main и работающий сайт не изменены.**
