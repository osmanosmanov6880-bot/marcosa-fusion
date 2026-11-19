# MARCOSA R170 — GitHub OIDC/STS, IAM-canaries, S3 Object Lock, read-only staging и PostgreSQL 17

Дата: 19 ноября 2026  
Репозиторий: https://github.com/osmanosmanov6880-bot/marcosa-fusion  
PR #168: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168  
Ветка: feature/marcosa-r150-growth-economics

## Состояние приёмки

В текущем проходе реализовано **пять полноценных блоков кода R170**. Сквозной workflow:
https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r170-readonly.yml

Подтверждённая первая полностью успешная проверка R170:
https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44545612083
(на исходном commit до добавления зафиксированного npm lockfile и расширения R163 source bundle). Новые контрольные проверки на точном окончательном SHA должны оцениваться по GitHub Actions отдельно.

**Не преувеличивать доказательства:** испытания CI проводятся на **настоящей одноразовой PostgreSQL 17**, но JWT GitHub, STS AWS, IAM и S3 серверы в интеграционном CI — **синтетические**, с настоящими *классами команд* AWS SDK v3 и проверяемой имитацией их ответов. Никаких действительных AWS-ключей, GitHub ID-token permission или обращений в AWS не было. Supabase production и данные клиентов не менялись.

## 1. OIDC → короткая AWS STS-сессия

Код: ops/r170/oidc-sts.mjs, ops/test/r170.oidc-sts.test.mjs.

- Проверка, что ручной запуск ограничен репозиторием, веткой feature/marcosa-r150-growth-economics, sha текущего HEAD и явным opt-in. Запрещены внешние endpoint overrides.
- Принимается краткоживущий OIDC JWT. До AWS запросов проверяются ограниченный JWT header (RS256/ES256, без jku/x5u/crit), issuer GitHub, audience sts.amazonaws.com, exact subject, repository, numeric owner/repo ID, commit/ref, iat/exp.
- **Локально подпись JWT не проверяется и доверять ему как credential нельзя**. Только AWS STS AssumeRoleWithWebIdentity может проверить реальную подпись и действующую trust policy.
- Используется официальная форма AssumeRoleWithWebIdentityCommand с RoleArn/RoleSessionName и **DurationSeconds=900**. Обязательная проверка Audience, SubjectFromWebIdentityToken и точного AssumedRoleUser.Arn ответа AWS.
- Только временные ASIA/STC credentials с sessionToken и сроком действия, проверенные существующим R169 guard. Секреты не сохраняются, не логируются и не попадают в отчёт.
- Модуль не вызывает сеть без allowExternalCalls=true и изолированного утверждённого runner. В CI AWS STS — тестовый mock; реальная AWS/OIDC trust ещё не подтверждена.

Официальная документация: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html

## 2. Проверка IAM: 7 разрешённых и 6 запрещённых сценариев

Код: ops/r170/iam-simulator.mjs, ops/test/r170.iam-simulator.test.mjs.  
Обновление R169: ops/r169/iam-plan.mjs — добавлено только s3:GetObjectVersionAttributes на закрытый namespace.

- Запросы официальной формы AWS SDK v3 SimulatePrincipalPolicyCommand к **строго указанному IAM role ARN**.
- 7 ожидаемых ALLOW: KMS GenerateDataKey/Decrypt с точным EncryptionContext и версия/retention/attributes/put encrypted object/read bucket.
- 6 ожидаемых DENY: удаление версии, bypass retention, изменение bucket policy, удаление KMS key, запись в production-prefix и KMS Decrypt с ложным "production" context.
- Любая ошибка AWS, частичная/пагинированная выдача, неверный action/resource, неизвестные missing context keys, неожиданный ALLOW для опасной операции или ошибочное DENY для разрешённой — весь прогон отклоняется.
- Результат годен 60 секунд и всегда productionAuthorized=false.
- **Ограничение AWS IAM SimulatePrincipalPolicy:** AWS не поддерживает моделирование resource-based policy для IAM roles. Симулятор может отличаться от фактических прав из-за bucket policy, KMS key policy, SCP, permissions boundary и session policy; эти результаты — только часть аудита, НЕ доказательство effective permission. Проверяющую IAM роль в реальном staging нужно предоставить отдельно, с минимальными read-only правами.

Документация: https://docs.aws.amazon.com/IAM/latest/APIReference/API_SimulatePrincipalPolicy.html

## 3. Независимое доказательство S3 version + COMPLIANCE Object Lock

Код: ops/r170/s3-retention.mjs, ops/test/r170.s3-retention.test.mjs.

- Проверяется зафиксированный versionId и content-addressed SHA-256, определяющие конкретный зашифрованный архив R165/R168.
- Настоящие команды AWS SDK v3 GetObjectRetentionCommand и GetObjectAttributesCommand используют ExpectedBucketOwner, exact Key, VersionId и список [Checksum,ObjectSize].
- Сопоставляются HEAD ObjectLockMode=COMPLIANCE, GetObjectRetention Mode=COMPLIANCE и одинаковое RetainUntilDate. Минимальный оставшийся срок 6 суток (для политики записи минимум 7 суток).
- Сравниваются GetObjectAttributes VersionId/ObjectSize/ChecksumSHA256 и HEAD; затем делается **полный GET шифротекста** той же версии через существующий R168 adapter, повторно считается SHA-256 (не ETag).
- Ни расшифровки KMS, ни восстановления или изменения S3 в этом модуле нет. Частичный, повреждённый или удалённый объект — отказ.
- Подпись AWS ответа и независимость offsite-аккаунта не доказываются модельным CI; настоящий облачный провайдер пока не подключён.

Документация: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectRetention.html
https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectAttributes.html

## 4. Объединённый одноразовый read-only staging gate

Код: ops/r170/read-only-stage.mjs, ops/test/r170.read-only-stage.test.mjs.

- Только ручной GitHub staging запуск; только source SHA, bundle, digest инвентаря PostgreSQL, S3 versionId/hash, scoped roleArn.
- Две независимые Ed25519 public-key pins оператора и reviewer проверяют R164 signed challenge на exact targetDigest; **два разных ключа не доказывают независимость людей**.
- До AWS read выполняется проверка CLOSED SQL-карантина. Новая STS-сессия используется для получения IAM/S3/KMS проверок; требуется соответствие Arn именно этой сессии.
- Поочерёдно проверяются R168 preflight, R169 bucket/KMS posture, R170 13 IAM canaries, R170 S3 Object Lock/version/full SHA256 readback. Любая недостаточность → отказ.
- Только после всех read-only проверок расходуется один nonce через внедрённый SQL-поставщик. Проверяется неизменность состояния SQL-карантина.
- Никаких PutObject, KMS Decrypt, реальных pg_restore/Supabase schema actions, production grants и выплат внутри этого блока.
- Успех означает **readOnlyStagingEvidenceVerified** и всегда **cloudIamEffectivePermissionsEstablished=false**; не разрешает переход в production.

## 5. Сквозной PostgreSQL 17 + pinned AWS SDK + независимый runner

Код: ops/r170/ci-acceptance.mjs, .github/workflows/marcosa-r170-readonly.yml, ops/r170/package.json, ops/r170/package-lock.json.gz.b64.

- CI не имеет GitHub id-token:write или AWS secrets. Загружает только опубликованные AWS SDK v3 STS/IAM/S3/KMS с top-level версиями **3.1170.0** и фиксированным транзитивным npm lockfile.
- Воспроизводимая фиксация зависимостей: закоммичен gzip+base64 JSON lockfile, который необходимо разархивировать и сверить SHA-256 **29825ad0ccbe541a7328e8293fe6ccde272a17bf26a6960f5d031d6cbd0c1e86**, только затем npm ci --ignore-scripts.
- Реальная одноразовая PostgreSQL 17: source fixture с RLS и приватными synthetic sessions/closed quarantine; native pg_dump -Fc → R168 AES-GCM через инжектированные локальные KMS/S3 клиенты → настоящий pg_restore в новую \`marcosa_r168_restored\` → независимая сверка строк, RLS, сессий и карантина.
- Одновременно тестируются **официальные классы команд** STS AssumeRoleWithWebIdentity, IAM SimulatePrincipalPolicy, S3 GetObjectRetention и GetObjectAttributes с локальными синтетическими данными без реальной сети.
- Две подписанные CI Ed25519-пары, локальный GitHub JWT fixture и **реальная отдельная SQL таблица с уникальным ключом nonce** проверяют успешное одноразовое read-only свидетельство и отклонение повторного nonce (даже при повторном вызове).
- Отрицательные сценарии: неизвестный результат IAM simulation, GOVЕRNANCE вместо COMPLIANCE retention, неверные OIDC claims, неверный role/target, нарушение RLS. Ошибки не дают production success.
- Второй GitHub runner с нулевыми AWS/PostgreSQL данными перепроверяет неперсональный отчёт и exact source SHA. Независимый workflow R163 дополнительно охватывает **все 64 обязательных исходных файла**, включая полный r170 dependency lock.
- В артефактах нет JWT, приватных ключей, plaintext PGDMP, AES DEK, пользовательских данных, сессий STS или паролей.

## NO-GO и необходимые внешние зависимости

Никаких реальных AWS-вызовов не совершалось. Для live read-only staging нужны: утверждённый отдельный AWS account, S3 versioned immutable bucket с Object Lock COMPLIANCE и KMS ARN; реальная защищённая GitHub environment с независимым человеческим review; официальный OIDC id-token, выданный только в этой environment; живой AWS STS и отдельно разрешённая IAM simulator auditor role; подтверждение SCP/permissions boundary и S3/KMS resource-based policies по независимому аудиту; отсутствие публичных bucket grants и жёсткие лимиты AWS расходов.

Для сквозного *реального* disaster recovery отдельно нужны выходной ключ KMS, проверенная offsite копия и независимое восстановление изолированного синтетического PG17 в другом окружении с контролируемым RPO/RTO. До этого R170 не является основанием для миграции личных данных, включения payments, производственной базы или доступа к production Supabase.

**productionAuthorized=false; main и публичный сайт не изменены.**
