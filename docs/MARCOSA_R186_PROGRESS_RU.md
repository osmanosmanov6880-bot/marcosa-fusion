# MARCOSA R186 — реальный read-only staging preflight и неизменяемые наблюдения

20 ноября 2026 · PR #168 · ветка `feature/marcosa-r150-growth-economics`

## Пять инженерных направлений, выполненных в коде

**1. Read-only GitHub PR и Environment.** `ops/r186/github-preflight.mjs` с разрешённым оператором read-only GitHub API считывает точный SHA PR #168, его подписанный коммит, всю историю review (до 4 страниц / 400 событий), актуальные APPROVED/CHANGES_REQUESTED на HEAD и правила GitHub Environment `marcosa-aws-staging`. Возвращает *только* агрегированные счётчики, флаги и SHA-256: не выводит имена пользователей, токены или исходные тела ответов. Ошибки сети, 403, некорректные JSON и неоконченная пагинация блокируют технический вывод. Реальное человеческое одобрение самостоятельно **не** подтверждается простым чтением API.

**2. Реальная проверка HTTPS health/ready и заголовков.** `ops/r186/https-preflight.mjs` принимает только вручную указанный lowercase FQDN вида `staging.имя.домен`; исключены localhost, IP, пользовательские URL, query и порты. Делает только `GET /health`, `GET /ready`, `HEAD /` по HTTPS:443, без cookies, auth и редиректов. Проверяет строгие статусы, JSON `status:ok/ready`, HSTS, `X-Content-Type-Options: nosniff` и `Cache-Control: no-store`. В отчёте отсутствуют содержимое ответов, данные клиентов и секреты. CI проверяет такой же контракт на *синтетическом fetcher*, не на реальном сайте.

**3. Отличать наблюдение от независимого разрешения.** `ops/r186/staging-assessment.mjs` связывает R185 из реального PostgreSQL17 и оба источника в одну SHA-цепочку, проверяет TTL и неизменность карантина; формирует 5 задач: реальная независимость GitHub-согласующих, staging HTTPS/TLS, IAM/SCP/KMS, приватность staging, реальное восстановление/RPO/RTO. Даже когда GitHub/HTTP проверки пройдены, в режиме CI они все считаются `BLOCKED`; реальные read-only наблюдения отображаются как `OBSERVED_PENDING...`, но *не* дают GO. Никакого автоматического деплоя или снятия карантина.

**4. PostgreSQL17 audit и ручной операторский инструмент.** `tests/postgres/187_r186_staging_observation_hold.sql` + `ops/r186/observation-ledger.mjs`: SERIALIZABLE, NOLOGIN, INSERT/SELECT-only, FORCE RLS, одна неизменяемая NO-GO запись и отдельная audit-таблица, точное соединение с R185, replay protection. `ops/r186/operator-preflight.mjs` запускается *только вручную вне CI* и с явным флагом. Проверяет GitHub API + разрешённый HTTPS хост, никогда не записывает реальные внешние данные. Синтетический CI не запускает реальный операторский инструмент.

**5. Regression + реальный PostgreSQL17 CI.** `ops/test/r186.preflight.test.mjs` включает атаки на HEAD/подпись/review, 403 и неполную пагинацию, redirects/unsafe hosts, headers, неверные JSON, ложный GO и replay. `ops/r186/ci-acceptance.mjs` делает нативный disposable PostgreSQL17 write-once R186 hold/audit, `pg_dump -Fc`, восстановление в *новую* БД, сверку FORCE RLS/закрытого карантина/отказа повторного INSERT. Второй runner без AWS/PG секретов повторно пересчитывает исходный SHA и все доказательства. Новый workflow: `.github/workflows/marcosa-r186-readiness.yml`.

Контрольный манифест: **167 файлов**. `main`, публичный сайт, реальная staging-среда, продакшен, платежи и клиентские данные не изменяются. **realPilotAuthorized=false**, **productionAuthorized=false**.

## Ручной read-only запуск

У оператора должна быть законная возможность читать GitHub PR/Environment, его fine-grained token нельзя отправлять в чат, коммит, логи или CI. Из точного reviewed checkout нужно задать `R186_ALLOW_READONLY=YES_NO_DEPLOY`, `R186_SOURCE_COMMIT`, `R186_BUNDLE_SHA256`, `R186_GH_READ_TOKEN` и `R186_STAGING_HOST` (конкретное разрешённое staging доменное имя). Затем выполнить `node ops/r186/operator-preflight.mjs --read-only`. Скрипт пишет лишь обезличенный JSON на stdout и никакой конфигурации не меняет.

Факт наличия успешных синтетических GitHub/HTTPS тестов не доказывает actual HTTPS, независимые личности или IAM права. **Техническая приёмка R186 — только 2 SUCCESS jobs одного workflow на одном точном SHA.**
