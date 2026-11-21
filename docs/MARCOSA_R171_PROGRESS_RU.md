# MARCOSA R171 — изолированная проверка GitHub OIDC, IAM, S3 и PostgreSQL 17

Дата: 19 ноября 2026 года
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
Branch: feature/marcosa-r150-growth-economics

## Состояние

Реализованы 5 крупных блоков исходного кода, SQL и GitHub Actions. Первый успешный R171 workflow: https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44551897506 — 12/12 новых модульных тестов, настоящий PG17 custom dump и restore, сохранение RLS/nonce/audit, отказ при повторном nonce из другого процесса и независимый второй GitHub runner. После этого исходного SHA добавлены три read-only AWS IAM разрешения. Для последнего коммита нужно смотреть его отдельный CI run.

Критически важно: клиенты AWS и классы команд AWS SDK v3 настоящие (3.1170.0), но в CI ответы STS, IAM, S3, KMS и GitHub OIDC — полностью синтетические. Никакой реальный AWS аккаунт или защищённая GitHub environment не использованы. ProductionAuthorized=false.

## Блок 1. GitHub OIDC — будущий защищённый ручной staging

Файлы: ops/r171/oidc-provider.mjs, ops/test/r171.oidc-provider.test.mjs.

- Требуются exact repository + immutable numeric IDs, SHA, feature ref, workflow_dispatch, attempt=1, заявленное имя staging environment и явный операторский opt-in.
- Отсутствуют статические AWS ключи, профили и endpoint overrides. HTTPS token request URL допускается лишь для строго ограниченных hosts GitHub Actions; audience исключительно sts.amazonaws.com.
- Native fetch работает без redirects и с таймаутом, проверяет HTTP 200, JSON, длину токена и корректную форму. Claims JWT сверяются с точными commit/ref/issuer/audience. Локальная проверка НЕ подтверждает подпись. Подлинность обязан проверить AWS STS через R170.
- Реальный ручной workflow marcosa-r171-live-staging.yml не создан и id-token permission не выдан. Его запуск до независимой настройки защищённой environment остаётся заблокирован.

Документация: https://docs.github.com/en/actions/reference/security/oidc

## Блок 2. IAM: проверка реальной конфигурации роли вместо одной симуляции

Файлы: ops/r171/iam-role-audit.mjs, ops/test/r171.iam-role-audit.test.mjs.

- Read-only AWS SDK v3 GetRole, ListRolePolicies, ListAttachedRolePolicies, GetRolePolicy, GetPolicy, GetPolicyVersion.
- Сверяются actual trust policy с детерминированным R169 trust, exact IAM role ARN, RoleId, максимальная длительность сессии, отсутствие attached managed policies и ровно одна разрешённая inline policy.
- Permissions boundary должна существовать под exact ARN marcosa-staging-deny-boundary; текущая default version должна иметь те же scoped allow/deny rules, что и рассмотренная R169 policy.
- Поддерживаются обычный IAM JSON и URL-encoded документы, расширенные привилегии, неожиданные политики, пагинация и разные источники отклоняются.
- Не является доказательством effective permissions (SCP, KMS key policy, S3 bucket policy, session controls); потребуется отдельная независимая read-only IAM auditor identity.

AWS: https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetRole.html

## Блок 3. История версий и публичность S3 Object Lock

Файлы: ops/r171/s3-version-audit.mjs, ops/test/r171.s3-version-audit.test.mjs.

- Read-only GetBucketPolicyStatus, ListObjectVersions и GetObjectLegalHold привязаны к ExpectedBucketOwner, bucket, exact content-addressed object path и versionId.
- S3 версия должна быть единственной и последней; DeleteMarkers отсутствуют, listing не усечён, policy IsPublic=false и legal hold известен.
- Существующий R170 S3 witness независимо проверяет COMPLIANCE retention, HEAD, GetObjectAttributes, полный ciphertext GET и SHA256 bytes. Метаданные без настоящего чтения шифротекста не принимаются.
- В ops/r169/iam-plan.mjs добавлены только необходимые read-only права s3:ListBucketVersions и s3:GetBucketPolicyStatus (bucket ARN) и s3:GetObjectLegalHold (object prefix).
- Дополнительные версии, delete markers, governance retention, public grant и повреждение архива вызывают отказ.
- Проверка не доказывает отдельный offsite аккаунт, provider identity или фактическое применение AWS политик.

AWS: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html

## Блок 4. PostgreSQL 17 — одноразовый допуск и журнал в одной транзакции

Файлы: tests/postgres/174_r171_fence.sql, ops/r171/pg-fence.mjs, ops/test/r171.pg-fence.test.mjs.

- SQL разрешён только на одноразовой базе postgres после R167 synthetic fixture; никакого применения в production или в пользовательском Supabase нет.
- В приватной схеме r171_ci создана таблица fenced_runs с уникальным nonce, commit, архивным SHA256, review digest, staging IAM ARN и обязательным production_authorized=false.
- Отдельная fenced_audit хранит одно событие на nonce, обе вставки происходят в единой транзакции через SET LOCAL ROLE, INSERT ... ON CONFLICT DO NOTHING и CTE, плюс обязательную проверку результата 1|1.
- FORCE ROW LEVEL SECURITY включена на обеих таблицах, writer NOLOGIN/NOBYPASSRLS может только SELECT/INSERT. Публичные роли не видят данные; UPDATE/DELETE в writer запрещены.
- Второй процесс получает 0|0 и отклоняется, audit нельзя частично подтвердить. Настоящий pg_dump -Fc/pg_restore сохраняет nonce, audit и RLS в новой изолированной базе.
- Это синтетический security lab, а не неизменяемый журнал против компрометации суперпользователя PG.

## Блок 5. Два CI runner, настоящее восстановление PostgreSQL 17 и зафиксированные зависимости

Файлы: ops/r171/ci-acceptance.mjs, .github/workflows/marcosa-r171-ci.yml, расширены ops/r162/release-evidence.mjs и ops/r163/repro-bundle.mjs.

- Реальные пакеты AWS SDK v3 IAM, STS, S3, KMS версии 3.1170.0 загружаются с ранее сохранённым полным транзитивным npm lockfile R170: SHA-256 29825ad0ccbe541a7328e8293fe6ccde272a17bf26a6960f5d031d6cbd0c1e86. Установка через npm ci без scripts.
- 12/12 новых Node.js unit tests на OIDC, IAM, S3 и PG nonce, включая негативные сценарии.
- В одноразовой postgres:17-alpine создаются RLS/сессии/карантин, nonce и audit. Настоящий pg_dump -Fc проходит существующий R168 AES-256-GCM pipeline с синтетическими KMS/S3 ответами; затем pg_restore восстанавливает отдельную базу и повторно проверяет строки/RLS/журнал.
- Используются настоящие конструкторы команд SDK, но все AWS IAM/STS/S3 сетевые ответы CI подменяет ограниченными mock fixtures. GitHub OIDC в CI тоже синтетический.
- Второй runner не получает AWS/PG credentials: он сверяет точный source SHA, доказательства и исключает любые production claims.
- Независимый R163 source bundle расширен на R171 исходники и SQL 174; безопасный лимит 80 файлов вместо прежних 64. Исходники проверяются на симлинки, размер и точные SHA256.

## NO-GO: чего нет

Не подключены реальный AWS staging account, KMS/S3, IAM auditor, проверенная GitHub protected environment, настоящий OIDC JWT, STS credentials, IAM/SCP effective permissions, независимые offsite backups, live Supabase, реальные платежи/выплаты. Нет real-user restoration или production test. Код не меняет main, публичный сайт и production.

Для реального изолированного staging потребуется отдельно утверждённый AWS account, защищённая GitHub environment с реальными human approvals, применённые и проверенные IAM/OIDC/KMS/S3 политики, read-only IAM auditor и ручной запуск строго утверждённого workflow. Только после независимого аудита можно проводить live read-only испытание на синтетических данных.
