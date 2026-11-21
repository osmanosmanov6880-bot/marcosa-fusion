# MARCOSA R178 — независимый staging-аудит двух облачных контуров

Дата: 19 ноября 2026. PR #168; ветка `feature/marcosa-r150-growth-economics`.

## Пять крупных блоков

1. **Два независимых STS-свидетельства** (`ops/r178/identity-audit.mjs`): отдельные клиенты и AWS account ID, строго закреплённые ARN + RoleId + OIDC session, TTL 60 секунд и SHA256 всех полей. Строго read-only, сеть выключена по умолчанию. В CI ответы STS — синтетические; никакого утверждения о действительных AWS-аккаунтах.
2. **Полная проверка S3 в двух аккаунтах** (`ops/r178/replica-audit.mjs`): только точные версии `HeadObject/GetObject/GetObjectRetention`; Object Lock COMPLIANCE, шифрование разными KMS ключами, BucketVersioning, четыре Public Access Block флага, конечный SHA256 всех шифрованных байтов. При коротком стриме, подмене версии или KMS, неверном хеше или выключенном Object Lock — отказ. В CI используются синтетические зашифрованные *пробы* и SDK-команды, а не реальные R174 архивы и не реальная репликация.
3. **Минимальные IAM-права** (`ops/r178/iam-plan.mjs`): точные read-only действия S3/KMS и доверие OIDC исключительно проверяемому staging environment. Канонический SHA256 плана, изменение политики или wildcard-условия отвергается. Это проект политики, а не свидетельство применения в IAM.
4. **Зависимый от R177 gate** (`ops/r178/readiness-gate.mjs`): проверяет R174 high-water и уже записанный R177 outcome, исторический root SHA и bundle, две последовательные PostgreSQL-проверки до/после обращения к STS/S3, TTL доказательств. Единственный допустимый итог — `CI_SIMULATION_COMPLETE`; никакой автоматической публикации или доступа к production.
5. **Реальный PostgreSQL17 + независимая CI-приёмка** (`tests/postgres/179_r178_readonly_gate.sql`, `ops/r178/staging-ledger.mjs`, `ops/r178/ci-acceptance.mjs`): RLS, append-only evidence + audit, SERIALIZABLE, один результат на проверенное восстановление, cross-process replay denial, native `pg_dump -Fc` и `pg_restore` в отдельную БД с повторным контролем ролей. Второй runner без секретов проверяет исходный bundle и не-секретный отчёт.

## Ограничения и запреты

`productionAuthorized=false`. Нет действительных STS/IAM/S3/KMS вызовов, реальных человеческих approvals, проверенной AWS cross-account репликации, реального Supabase, production RPO/RTO или deployments. Настоящий в CI — только одноразовый PostgreSQL 17. Два независимых API-объекта с синтетическими ответами **не** являются независимыми провайдерами или подтверждением доступности реальных AWS-аккаунтов.

Принятие: оба jobs GitHub Actions R178 на точном head SHA успешны. Main и публичный сайт не изменяются.
