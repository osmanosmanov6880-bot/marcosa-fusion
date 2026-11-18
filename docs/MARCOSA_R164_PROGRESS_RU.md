# MARCOSA R164 — пять реализованных инженерных блоков

Дата: 18 ноября 2026 года.
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
Ветка: feature/marcosa-r150-growth-economics

## Проверенная реализация

В код внесены пять блоков R164. Основная CI-приёмка: https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44346951069
Результат: 67/67 тестов R160–R164. На одноразовом PostgreSQL 17 прошли реальные TLS, JWT/сессии и RLS, rollback перед COMMIT, pg_dump/pg_restore в другую базу, отрицательные сертификаты, отказ при аварийном разрыве, синтетическое подтверждение двумя Ed25519 ключами и немедленное закрытие write-gate.
Отдельный workflow R163 выполняет независимую byte-for-byte пересборку исходников в новом runner на том же Git SHA. R164 исходники добавлены к обязательному набору файлов этого workflow.

### 1. Immutable staging target

Файлы: ops/r164/staging-target.mjs, ops/test/r164.staging-target.test.mjs.

Профиль строго связывает Git SHA, SHA-256 исходного source bundle, Supabase projectRef, staging-only HTTPS origin, отдельное имя PostgreSQL, отпечаток CA, TLS SPKI и публичный fingerprint закрытой конфигурации. Неизвестные поля, изменённый сертификат, иной bundle или source commit, production-среда, слушатель 0.0.0.0 и активированные платежи/выплаты/автоматический деплой отвергаются. Синтетические хосты принудительно имеют окончание .example.invalid, а внешние данные не становятся автоматически одобренными. Нет секретов в публичном evidence.

### 2. Две Ed25519-подписи и одноразовое разрешение

Файлы: ops/r164/change-quorum.mjs, ops/test/r164.change-quorum.test.mjs.

Каноническая подпись привязана к exact source commit, digest профиля, уникальному 128-bit nonce, scope staging-rehearsal-only и окну не более пяти минут. Проверяется два разных публичных ключа с SHA-256 SPKI pins для operator и independent-reviewer, и каждая подпись Ed25519. Дубликаты роли, ключа, неверная подпись, просрочка и подмена SHA отказываются. Одноразовая in-memory nonce-fence запрещает повтор внутри процесса и допускает только synthetic rehearsal.
Важно: разные криптографические ключи не доказывают разных людей, in-memory fence не защищает от повторов между серверами или рестартами. Требуется независимая личная аттестация и durable nonce table до реального rollout.

### 3. Срочная карантинизация и исправление гонки запуска

Файлы: ops/r164/emergency-rollback.mjs, ops/test/r164.emergency-rollback.test.mjs; обновлён ops/r162/lifecycle.mjs.

Остановка синхронно отзывает readiness на запись, затем запускает закрытие сервиса и записывает неперсональные категории происшествий в хешированный журнал. При тайм-ауте или неизвестном результате status = unverified; никогда не заявляется успешный shutdown. Нет автоматического повторного запуска. Исправлена гонка start/stop: epoch fence не позволяет позднему успешному подключению PostgreSQL или TLS вернуть ready после аварийного drain. Протестировано одновременное выполнение старта/остановки и отказ при тайм-ауте.

### 4. Восстановление PostgreSQL 17 с проверкой фактических данных

Файлы: ops/r164/restore-witness.mjs, ops/test/r164.restore-witness.test.mjs, ops/r164/ci-restore.mjs.

Сначала из одноразовой исходной PostgreSQL базы читаются безопасные SQL-агрегаты: editor revision, number of accepted commands, unique webhook inbox и duplicates, active и revoked sessions, RLS и права authenticated. Затем настоящий pg_dump custom archive проходит SHA-256 после записи на диск и восстанавливается через pg_restore в отдельную новую базу marcosa_r164_restored. Повторные SQL-агрегаты должны точно совпадать: revision 2, commands 2, inbox rows 1, accepted count 2, revoked session 0, active session 1, RLS включён, browser privileges закрыты. Порченый архив должен быть отвергнут. В CI #44346951069 измеренное время этой локальной восстановительной операции — 687 мс. Это лабораторное значение, не SLA real Supabase.

### 5. Единая эксплуатационная приёмка и CI

Файлы: ops/r164/operations-audit.mjs, ops/test/r164.operations-audit.test.mjs, ops/r164/ci-ops-gate.mjs, .github/workflows/marcosa-r160-staging.yml, .github/workflows/marcosa-r163-release.yml.

После успешных прежних R160–R163 проверок запускается R164: настоящие синтетические Postgres restore, R163 HTTPS/Ed25519 acceptance, две новых ephemeral Ed25519 подписи, проверка использования nonce ровно один раз, реальный R160 PostgreSQL/TLS gateway и его аварийное закрытие. Композитный аудит связывает шесть доказательств: commit/bundle, frozen target, dual key signatures, свежий restore, подтверждённый shutdown и предыдущий R163 source/SLO gate. Любая ошибка блокирует решение. Полностью зелёный synthetic результат всегда CI_REHEARSAL_COMPLETE, НЕ разрешение deployment. Независимый staging аудит, человеческие роли и production deployment не выполняются.

## Что осталось заблокированным

Нет реального managed Supabase, реального staging-домена/внешней сети, credential vault, offsite encrypted restore, независимой подписи реальных reviewers, long-lived nonce журнала, real Push/Email/SMS, реальных платежей, возвратов и выплат авторам, обновления production или merge в main. Никакие рабочие данные и публичный сайт в ходе R164 не менялись.

## Актуальные справочные источники

Supabase breaking changes: https://supabase.com/changelog?types=breaking-change
Supabase TLS: https://supabase.com/docs/guides/security/tls
Supabase Auth sessions: https://supabase.com/docs/guides/auth/sessions
Supabase SSL enforcement: https://supabase.com/docs/guides/platform/ssl-enforcement

В ноябре 2026 Supabase опубликовал переход CLI v3 к локальному стеку по умолчанию и предупреждение об устаревших HTTP TLS 1.2 CBC cipher suites. В R164 никаких удалённых CLI или API-изменений Supabase не выполнялось.
