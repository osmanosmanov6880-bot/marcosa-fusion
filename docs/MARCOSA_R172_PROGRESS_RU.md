# MARCOSA R172 — защищённая GitHub environment, AWS STS/IAM, offsite S3/KMS и измеряемое восстановление PG17

Дата разработки: 19 ноября 2026 года.
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
Branch: feature/marcosa-r150-growth-economics

## Статус и граница утверждений

В текущем проходе внесены пять крупных блоков в серверный код, тесты и workflow. Рабочий CI: https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r172-readiness.yml

На момент подготовки этого файла CI находился в очереди; актуальная приёмка относится только к конкретному SHA, проверенному в GitHub Actions. Отчёт не заявляет заранее успешный CI.

- В тестовом сценарии используются настоящая одноразовая PostgreSQL 17, native pg_dump/pg_restore, транзакционный SQL nonce, проверка RLS и локальная криптография AES-256-GCM.
- AWS SDK v3 IAM/STS/KMS/S3 используется из полного транзитивного lockfile, закреплённого в R170, но **AWS API ответы в CI моделируются внедрёнными объектами, без сети к AWS**.
- Запросы GitHub REST API и GitHub OIDC также моделируются в CI; **не установлено**, что реальная GitHub environment защищена и что два разных человека подписали deploy.
- Нет реальной offsite копии. Конфигурация репликации S3 не гарантирует доставку объекта; ошибки ключа назначения/политик IAM могут приводить к тихой ошибке реальной репликации.
- Код не меняет main, production, hosted Supabase, платёжные системы и публичный сайт.

## Блок 1. GitHub protected-environment verification, только GET

Файлы: ops/r172/github-environment.mjs, ops/test/r172.github-environment.test.mjs.

- Получает через GET только https://api.github.com/repos/osmanosmanov6880-bot/marcosa-fusion/environments/marcosa-aws-staging, deployment-branch-policies и actions/runs/<run_id>.
- Требует workflow_dispatch текущей ветки, SHA и immutable owner/repo IDs; запрещает результаты fork/other workflow/run attempt.
- Проверяет существование environment, custom branch policy ровно одной literal ветки, наличие GitHub branch_policy + required_reviewers и prevent_self_review=true.
- Требует минимум 2 независимых зарегистрированных GitHub User reviewer IDs, при этом инициатор run не должен входить в их список.
- GitHub product nuance: наличие двух **назначенных** reviewer IDs не означает, что система потребовала **две фактические approval**: GitHub environment может допускать запуск после одного approver. Поэтому результат всегда twoActualHumanApprovalsVerified=false. Перед реальной работой нужны отдельно независимые подписанные authorizations.
- Любой 403/404, отсутствующая административная read permission, wildcard branch, self-review, смена SHA или JSON drift ведут к fail closed. Нет create/update environment, доступ выключен по умолчанию.
- GitHub API GET environment может потребовать Administration(read) токен с минимальными правами, который нельзя выводить в CI logs.

Документация GitHub: https://docs.github.com/en/rest/deployments/environments

## Блок 2. AWS STS caller + IAM GitHub OIDC-provider inspection

Файлы: ops/r172/aws-identity.mjs, ops/test/r172.aws-identity.test.mjs.

- STS GetCallerIdentity вызывается с заранее полученными из R170 staging session credentials. Требует точные Account, UserId (RoleId:RoleSessionName) и Arn с role/marcosa-staging-backup-role.
- Независимый IAM read-only auditor client выполняет GetOpenIDConnectProvider на pinned arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com.
- Требуются exact issuer host, единственный audience sts.amazonaws.com и корректная форма ThumbprintList.
- Сессия и аудит OIDC могут быть из разных credential sources, но независимость личности аудитора и реальность IAM effective rights **не считаются доказанными**.
- Проверки привязаны к exact account, runId, roleId и 60-секундной свежести. По умолчанию никакого сетевого доступа.

Документация AWS: https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetOpenIDConnectProvider.html

## Блок 3. Read-only проверка раздельного AWS offsite и ротации KMS

Файлы: ops/r172/replication-audit.mjs, ops/test/r172.replication-audit.test.mjs.

- Три отдельно внедрённых SDK-клиента: исходный S3, исходный KMS, offsite KMS из другого AWS account и региона.
- GetBucketReplication проверяет ровно одно enabled правило с явным префиксом marcosa/isolated/r168/, replica target bucket ARN, Destination.Account, конкретным KMS ARN и запретом DeleteMarkerReplication.
- SSE-KMS encrypted source selection должен быть enabled. IAM role для S3 replication фиксирован как marcosa-staging-cross-account-replication в исходном account.
- DescribeKey + GetKeyRotationStatus вызываются на обоих ключах. Требуются independent source/destination accountId, разные регионы, exact key ARNs, enabled SYMMETRIC_DEFAULT/ENCRYPT_DECRYPT и включённая ротация обоих ключей.
- Успех означает только наблюдавшуюся конфигурацию. Для реального доказательства резервной копии нужны **cross-account object HEAD/GET, отдельный audit destination Object Lock и фактический тест restore с destination KMS**.
- Если репликации нет, статус governance/deletion изменён, указаны неправильные ключ/аккаунт, ошибка сети или ключ выключен — отказ.

Документация AWS: https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-config-for-kms-objects.html

## Блок 4. Измерение ограниченного recovery window в настоящей PG17

Файлы: ops/r172/recovery-budget.mjs, ops/test/r172.recovery-budget.test.mjs.

- Контролирует до/после snapshot: закрытый SQL карантин не должен меняться; R167 non-PII fixture inventory сверяется до и после создания зашифрованного архива.
- Требует один успешно записанный nonce и один audit row, точную ссылку на архив с pinned commit + source bundle SHA256 и productionAuthorized=false.
- Восстановление разрешено только в отдельный, ранее зарезервированный R168 target name marcosa_r168_restored внутри нового disposable PG17 runner.
- После восстановления independently SQL сверяет строки, RLS, active/revoked sessions, nonce/audit и доказывает, что повторное использование nonce на восстановленной базе **отклоняется**.
- Измеряется длительность от restore start до окончания row/RLS/nonce verification по монотонным часам. Отклоняется если превышает заданную 120-секундную synthetic acceptance границу.
- Итог содержит sha256 receipt, syntheticRowsLost=0 и observedSyntheticRtoMs. **Это НЕ производственный RPO/RTO**: синтетическая fixture статична, параллельного потока реальных записей и offsite задержки в этом испытании нет.

## Блок 5. End-to-end GitHub Actions и второй независимый runner

Файлы: ops/r172/ci-acceptance.mjs, .github/workflows/marcosa-r172-readiness.yml, изменены ops/r162/release-evidence.mjs, ops/r163/repro-bundle.mjs и workflow r163.

- CI имеет permissions.contents=read, не получает id-token:write или настоящие AWS credentials, не выполняет реальные облачные вызовы.
- Использует Node.js 24, postgres:17-alpine; восстанавливает оригинальный R170 SHA-pinned npm lockfile 29825ad0ccbe541a7328e8293fe6ccde272a17bf26a6960f5d031d6cbd0c1e86 и делает npm ci без install scripts.
- Проверяет все новые R172 контракты плюс R171 regression, включая негативные подмены GitHub/IAM/S3 и SQL/restore.
- Настоящие PG17 SQL fixtures R167+R171: новая зашифрованная AES-GCM копия, native pg_dump -Fc/pg_restore, повторная проверка private RLS/активных и отозванных sessions, закрытого карантина, аудит-допуска и replay.
- Второй GitHub Actions runner без AWS/PG credentials читает только неперсональный JSON evidence, снова хеширует полный source bundle и отклоняет поля, выдающие simulated GitHub/AWS/offsite proof за production.
- В R163 source bundle добавлены все пять R172 implementation files, а R162 release-evidence позволяет только конкретный новый путь ops/r172/. Список по-прежнему ограничен максимум 80 файлами.

## NO_GO и будущая эксплуатационная приёмка

Для перехода к реальному staging нужны отдельно: реально созданная защищённая GitHub environment, подтверждённый пользовательский MFA/reviewer механизм, read-only GitHub Administration token, отдельный AWS account/бюджет, OIDC trust, IAM role/permissions boundary, read-only IAM auditor, действующие S3 buckets и Object Lock/replication, две KMS keys с отдельными access policies. Эти ресурсы и подтверждения в текущей работе не создавались.

Любой реальный вызов должен быть отдельным явно разрешённым оператором ручным workflow. Пока нет этого основания: productionAuthorized=false, actualAwsProviderConnected=false, actualOffsiteReplicaRestored=false, productionRpoRtoProven=false, actualSupabaseChanged=false.
