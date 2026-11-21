# MARCOSA R162 — staging lifecycle, fail-closed recovery, evidence и проверка отказов

Дата: 18 ноября 2026 года.
Репозиторий: https://github.com/osmanosmanov6880-bot/marcosa-fusion
PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
Ветка: feature/marcosa-r150-growth-economics

## Зафиксированный результат

Полный R160–R162 набор прошёл на изолированном GitHub runner с настоящей PostgreSQL 17 и TLS:
https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44306210637

**36/36 новых и регрессионных Node-тестов R160–R162, 0 ошибок.** Также прошли реальные HTTP/JWT/PostgreSQL проверки R160–R161, отзыв сессии перед COMMIT с ROLLBACK, signed HMAC inbox и восстановление БД. R162 fault drill подтвердил отказ после убийства соединений PostgreSQL, восстановление роли/соединений, закрытие записи при истечении кэша JWKS, отказ при поддельном CA и проверку цепочки инцидентов.

Изолированный SHA-256 evidence source manifest:
e30e3c657a2f6c0b6fa55876eb29dcc8b805b5341c728978bb47e136e1c1d26a

Manifest собран по **CI checkout SHA**, содержит SHA-256 всех 10 обязательных исходников и доступен как краткоживущий GitHub Actions artifact с именем marcosa-r162-local-evidence. Это локальное сопоставление исходников, **не независимая криптографическая подпись** и не утверждение production-готовности.

## Пять выполненных инженерных блоков

### 1. Атомарный запуск staging и обратный откат компонентов

Файлы:
- ops/r162/lifecycle.mjs
- ops/test/r162.lifecycle.test.mjs

Реализована последовательная сборка командного сервера R160, локального control-plane и HTTPS ingress R161. Все слушатели работают только на 127.0.0.1, никакой автоматической публикации наружу. Перед созданием TLS ingress проверяются signed Auth/JWKS/PG readiness и отсутствие productionReady. Ошибка запуска любого последующего компонента вызывает обратное закрытие ingress -> control -> runtime с освобождением пула. Повторный start уже запущенного/откаченного сервиса запрещён; drain идемпотентен. Operator factory проверяет X.509 имя/срок действия сертификата, загружает закрытую R161 конфигурацию и создаёт сборку БЕЗ запуска сети.

Проверено: успешный запуск, reverse-order cleanup, пять сценариев partial failure, отказ при 0.0.0.0 и неверном TLS.

### 2. Восстановление зависимостей без ложной готовности

Файлы:
- ops/r162/recovery-supervisor.mjs
- ops/test/r162.recovery-supervisor.test.mjs
- ops/r160/staging-service.mjs
- ops/r160/pg-driver.mjs
- ops/r159/secure-pool.mjs

R160 изменён так, что статус готовности требует одновременно свежий preflight, JWKS cache freshness и отсутствие draining. Проверки preflight имеют epoch/token; прежняя асинхронная проверка не может повторно открыть запись, если оператор/наблюдатель её отозвал. Добавлен revokeReady() для немедленного закрытия шлюза. Незадействованный Node PostgreSQL pool больше не выбрасывает необработанный error на сетевой разрыв: callback уведомляет runtime, runtime отзывает ready-state.

R162 supervisor выполняет явный poll под операторским scheduler, без автоматических фоновых вызовов. При отказе PostgreSQL/Auth/JWKS немедленно отзывает доступ и применяет экспоненциальный backoff 0.5–4 сек в CI (конфигурируемые безопасные границы). Дубликаты одновременных poll схлопываются. Re-arm возможен только после успешного свежего preflight; после disable восстановление запрещено.

Это модуль для будущего supervised процесса, не работающая на внешнем сервере служба мониторинга.

### 3. Контроль целостности локальной сборки и источников

Файлы:
- ops/r162/release-evidence.mjs
- ops/test/r162.release-evidence.test.mjs
- ops/r162/ci-release-evidence.mjs

Источник должен быть из точного репозитория osmanosmanov6880-bot/marcosa-fusion, с полным 40-значным lowercase commit SHA и абсолютным canonical checkout. Проверяются 10 обязательных файлов R160–R162, версии package-lock, TLS transport, session fence, staging gateway и новые модули. Повторное чтение сверяет размер, SHA-256 содержимого и детерминированную сортировку с сохранённым манифестом. Запрещены symlink, hardlink, traversal, скрытые credential/private/.env файлы и локально выдуманный productionApproved.

Отдельный SHA-256 исходников сам по себе не доказывает подпись независимого ревьюера; итоговые поля productionAuthorized и externalDeploymentVerified всегда false.

### 4. Неперсональный журнал инцидентов со сцепленными хешами

Файлы:
- ops/r162/incident-ledger.mjs
- ops/test/r162.incident-ledger.test.mjs

Журнал принимает только заранее согласованные категории (staging_start, staging_rollback, preflight_denied, session_revoked, restore_verified и т. п.) с одним из разрешённых результатов/этапов. Произвольные userId, email, API key, IP, текст и токен не принимаются. Каждый элемент содержит порядковый номер, монотонную временную отметку, предшествующий SHA-256 и SHA-256 собственной канонической записи. Память ограничена 4–200 последними событиями, с сохранением якоря удалённого префикса; snapshot можно сверить с head hash, полученным из независимо защищённого места.

**Не является неизменяемым или независимо подтверждённым журналом, пока его head не закреплён вне процесса.** В CI проверены изменения записи, удаление tail, чужой head, ограничение памяти и перемотка часов.

### 5. Реальные сценарии отказа в PostgreSQL 17 + регрессии + CI evidence

Файлы:
- ops/r162/ci-chaos.mjs
- ops/r162/ci-release-evidence.mjs
- .github/workflows/marcosa-r160-staging.yml (расширен до R160–R162)

CI продолжает:
1. Node 24 + npm ci --ignore-scripts по зафиксированному pg@8.23.1, **36/36** R160–R162 тестов.
2. Создание временного CA и настоящей PostgreSQL 17 с TLS, RLS и специальными ролями NOINHERIT/NOBYPASSRLS.
3. Настоящий signed HTTP → PostgreSQL SQL command, JWT session revocation before commit → ROLLBACK и реальная восстановленная приватная БД из pg_dump/pg_restore с SHA-256.
4. R162 supervisor: привилегированная CI-команда временно делает test login NOLOGIN, закрывает существующие соединения с pg_terminate_backend. Командный шлюз закрывается, GET /ready возвращает 503; после возврата LOGIN и нового TLS preflight — 200.
5. Искусственное истечение JWKS cache, закрытие readiness 503, обновление pinned public JWKS и повторный preflight. Подмена сертификата CA — TLS preflight отвергается.
6. CI сравнивает хеши исходников из манифеста после повторного чтения с отдельным краткоживущим artifact. Никакие настоящие Supabase, доставщики, платёжные API, VPS и продакшен базы не используются.

### Дополнительные официальные проверки

Supabase:
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/security/tls
- https://supabase.com/docs/guides/platform/ssl-enforcement

Официальная страница про TLS указывает, что доступы к API требуют TLS 1.2/1.3, а часть прежних CBC cipher suites может перестать поддерживаться начиная с 10 ноября 2026 года. Для staging закреплены CA, hostname и проверка TLS, никакого небезопасного fallback.

## Production NO_GO

Не подключены реальный управляемый проект Supabase, внешний staging-домен/сертификат с утверждённым владельцем, staging secrets manager, внешний webhook push/email/SMS провайдер, независимые подписи билдов и approval, offsite encrypted backup, эксплуатационный наблюдатель, legal/payments/payouts review. Нет merge в main и нет внешней коммерческой публикации.

**Следующий этап:** в настоящей, независимо одобренной staging-инфраструктуре подтвердить TLS, Auth, разрешения и резервное восстановление с реальными эксплуатационными метриками — прежде чем рассматривать production cutover.
