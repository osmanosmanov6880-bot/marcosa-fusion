# MARCOSA R188 — реальная повторная проверка Ed25519 и точная сверка приватных записей PostgreSQL

20 ноября 2026. [PR #168](https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168). Ветка `feature/marcosa-r150-growth-economics`.

## Пять крупных инженерных блоков

1. **Исправлена критическая регрессия R187 Ed25519:** в `ops/r187/staging-gate.mjs` повторная проверка подписей сравнивает устойчивые поля криптографического доказательства, публичные ключи, роли и exact SHA. Не требует совпадения `observedAtMs` с точностью до миллисекунды; по-прежнему проверяет исходный hash и срок годности. Исправленный R187 прошёл 2/2 CI на коммите `abcd0f95375c09ece698719f13f89acf7162cd86`.
2. **Полноценный переносимый transcript** (`ops/r188/signed-transcript.mjs`): два настоящих Ed25519 ключа и подписи на exact source/предыдущих GitHub/HTTPS SHA, канонический JSON, публичные SPKI, 2 роли, SHA файла. **Второй runner действительно проверяет обе подписи криптографически** по присланным публичным ключам, а не просто доверяет полю `cryptographicSignaturesValid`. Подмена ключа, подписи или текста блокируется. Ключи в CI эпизодические; реальных людей не подтверждают.
3. **Проверка содержимого хранения на двух нативных PostgreSQL17** (`ops/r188/retention-integrity.mjs`): независимое чтение из primary и из R187 restored DB. Проверяются все восемь непросроченных детерминированных строк, отсутствие четырёх удалённых строк, содержимое SHA, FORCE RLS, отсутствие доступа `authenticated`, неизменность предшествующего NO-GO/карантина. Нет новых DELETE. Это тест синтетических данных, не полноценное GDPR-исследование.
4. **Неизменяемая связь доказательств в PostgreSQL17**: `ops/r188/staging-gate.mjs`, `ops/r188/observation-ledger.mjs`, `tests/postgres/189_r188_signed_retention_hold.sql` — exact R187 nonce/sequence/source, reverified подписи и два PG17 набора в одну SERIALIZABLE одноразовую запись `NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING` и отдельный audit. NOLOGIN, FORCE RLS, INSERT/SELECT only, no UPDATE/DELETE/replay, closed quarantine.
5. **Атакующие тесты и двухступенчатая CI-приёмка** (`ops/test/r188.attestation.test.mjs`, `ops/r188/ci-acceptance.mjs`, `.github/workflows/marcosa-r188-readiness.yml`): проверка подмены публичных ключей, signatures, RLS, source race, повреждения rows, replay, реального PG17 backup/restore и независимой проверки SHA плюс обеих Ed25519 подписей вторым runner без PG/AWS доступов.

Контрольный manifest: **181 исходный файл**. Workflow продолжает последовательность R175–R187, но не изменяет `main`, живой сайт, реальные AWS ресурсы, данные пользователей и платежи.

## Что не подтверждено

Наличие двух настоящих подпечатанных временных CI ключей **не устанавливает идентичность людей**, их согласие или корректность реальных GitHub Environment. Синтетическая retention таблица не подтверждает соблюдение приватности на реальных данных. Actual IAM/SCP/KMS, TLS идентичность и RPO/RTO в staging остаются отдельными задачами. `realPilotAuthorized=false`, `productionAuthorized=false`.

Техническая приёмка R188 — **только два SUCCESS задания одного workflow на точном SHA**, включая независимую криптографическую перепроверку подписей. Код не публикуется автоматически.
