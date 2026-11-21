# MARCOSA R161 — безопасный staging, изоляция сессий и подписанный inbox

Дата: 18 ноября 2026 года
Репозиторий: https://github.com/osmanosmanov6880-bot/marcosa-fusion
Pull request: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168
Ветка: feature/marcosa-r150-growth-economics

**Статус:** пять крупных блоков R161 реализованы в исходниках. Полная лабораторная PostgreSQL 17/TLS/HTTP приёмка успешно прошла на implementation SHA ecc9b2f9966a6e0b0b0c8f0b70ce57d013692da0: [GitHub Actions #44300227602](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44300227602). Результат: 24/24 теста R160–R161, настоящий подписанный HTTPS → PostgreSQL 17, отзыв сессии внутри SQL с rollback, signed webhook inbox, pg_dump/restore с RLS. На последующих коммитах выполнено незначительное улучшение имени manifest-файла, без изменения механизмов авторизации. Результаты нового SHA сверять по соответствующему GitHub Actions.

**Ключевая граница:** это изолированные тесты и staging-компоненты. Никакие реальные Supabase Auth-сессии, пользовательские базы, VPS, сервисы email/SMS/Push, платежи, выплаты или рабочий публичный сайт не изменялись. Ни PR, ни main не развёрнуты в production.

## Пять реализованных блоков

### R161-1: Sealed staging configuration — только приватные файлы

Исходники: ops/r161/sealed-config.mjs, ops/test/r161.sealed-config.test.mjs.

- Оператор передаёт абсолютный canonical secretsRoot с правами доступа только владельцу и строго фиксированный manifest staging.txt.
- В manifest указываются только staging=true, точный Supabase projectRef, HTTPS origins, параметры PostgreSQL и имена четырёх приватных файлов; никаких произвольных ключей.
- CA certificate, пароль БД, token управления и подпись webhook хранятся отдельно, читаются O_NOFOLLOW и проверяются fstat.
- Файлы должны быть обычными, с одним hardlink, в приватном каталоге и без прав группы/других пользователей. Прямые ../ пути, symlink, hardlink, world-readable password, production flag и неизвестные поля отвергаются.
- Возвращаемая публичная информация не содержит паролей, сертификатов, токенов или webhook-secret.
- Сборка сервиса и локального control-plane доступна как explicit assembly, но сама НЕ подключает сервер и НЕ запускает сеть без команды оператора.
- Упоминание сильного токена не заменяет entropy validation; реальный оператор должен генерировать криптографически случайные секреты.

### R161-2: Сессионная защита внутри одной PostgreSQL транзакции

Исходники: ops/r161/session-fenced-store.mjs; обновлены ops/r157/pg-command-store.mjs, ops/r157/http-gateway.mjs, ops/r160/staging-service.mjs.

- Ранее проверенная HTTP подпись JWT передаёт sessionId и authExpiresAt в trusted store.
- До SQL-модификации и повторно после неё, перед COMMIT, в той же транзакции под SET LOCAL ROLE marcosa_r159_auth_reader вызывается параметризованный SELECT EXISTS по auth.sessions.id и user_id.
- Переключение роли обратно на marcosa_r156_writer и SET LOCAL actor claim никогда не сохраняются после транзакции.
- Просроченная, удалённая или неверно связанная с пользователем сессия -> HTTP 401 и ROLLBACK, отсутствующий доступ к БД -> 503 и ROLLBACK.
- Реальная PG17 интеграция в CI удаляет сессию второй админской транзакцией ПОСЛЕ выполнения SQL-команды, но ДО COMMIT. Повторный SELECT обнаруживает отзыв, завершение отменяется; проверены неизменные title, revision и журнал команд.
- Это сокращает окно TOCTOU, но не доказывает абсолютную линейризуемость относительно удаления сессии сразу ПОСЛЕ финальной проверки. Для настоящего production потребуется review managed Supabase Auth и её собственных гарантий согласованности.

### R161-3: Реальный TLS ingress со строгой проверкой HTTP

Исходники: ops/r161/tls-ingress.mjs, ops/test/r161.tls-ingress.test.mjs.

- Node HTTPS сервер получает сертификат и приватный ключ от доверенного оператора. Слушает только 127.0.0.1.
- Требует точного TLS SNI, HTTP Host и Origin; отвергает чужой host/origin, отсутствие ограничений, GET вместо POST, неизвестные URL и подозрительные query или encoded paths.
- Отбрасывает forwarding-спуфинг: X-Forwarded-For, Forwarded, X-Real-IP, cookies, proxy authorization, Transfer-Encoding и hop-by-hop headers.
- Перенаправляет к локальному R160 шлюзу только явные Origin/Authorization/Content-Type/Content-Length/Idempotency-Key.
- Ограничивает размер запросов, число параллельных соединений, время ожидания upstream и размер ответа. Нет настройки публичного 0.0.0.0 binding или автоматической активации.
- Тестируется настоящий сертификат в TLS socket, SNI/hostname validation и отказ при неправильном сертификате, Origin или Host.
- Для публичного staging всё ещё необходимы independently reviewed ingress/WAF, rate limiting, DNS, process supervision и подписанные deployment artifacts.

### R161-4: Подписанный webhook inbox с сохранением в приватной базе

Исходники:
- docs/MARCOSA_R161_WEBHOOK_INBOX_REFERENCE.sql
- ops/r161/webhook-inbox.mjs
- ops/test/r161.webhook-inbox.test.mjs

- Принимающая сторона проверяет точную HMAC-SHA256 подпись timestamp, nonce, idempotency-key и сырого JSON-body с constant-time comparison.
- Ограничены время подписи, nonce, размер сообщения, разрешённые поля JSON, UUID и ключ, детерминированный из episodeId:recipientId.
- В закрытом PostgreSQL schema private создаётся таблица r161_webhook_inbox с UNIQUE(delivery_key) и UNIQUE(episode_id,recipient_id), FK на существующий эпизод и Auth user, RLS и NOLOGIN receiver ролью.
- INSERT ... ON CONFLICT DO UPDATE увеличивает accepted_count в ОДНОЙ записи для повторной подписанной доставки с теми же идентификаторами. Несовместимый набор ID или запись без прав не принимается.
- HTTP 202 и точная idempotency-key/accepted-ack возвращаются только после COMMIT в реальной PG17.
- Это **однократная локальная запись событий**, а не exactly-once коммерческая доставка. Реальных внешних уведомлений и данных получателей нет.

### R161-5: Смешанная CI-приёмка, реальные HTTPS и восстановление PostgreSQL

Исходники:
- .github/workflows/marcosa-r160-staging.yml (расширено до R160–R161)
- ops/r161/ci-real.mjs
- tests/postgres/170_r161_restored.sql
- ops/test/r161.*.test.mjs

CI:
1. Выполняет npm ci по точному lockfile pg@8.23.1 и все 24 Node-теста R160–R161.
2. Создаёт одноразовый CA, запускает postgres:17-alpine с настоящим TLS и всеми R30/R41/R84/R155/R156/R157 reference schema.
3. Проверяет старый R160 flow, затем отдельный SSL-сертификат для staging.marcosa.example, HTTPS-запрос через ingress с подписанным ES256 JWT к реальному редактору.
4. Проверяет отказ чужому Origin и Host, затем отзыв сессии после SQL-модификации и перед COMMIT: серверная база не меняется, ROLLBACK.
5. Поднимает ограниченную NOINHERIT receiver-роль, отправляет два подписанных HMAC webhook через локальный sink и проверяет одну durable PostgreSQL-запись с accepted_count=2.
6. Делает настоящий PostgreSQL custom dump, SHA-256, восстановление в отдельную БД marcosa_r161_restored, проверку ревизий, откатной транзакции, отсутствия отозванной сессии, RLS приватного журнала и dedupe.
7. Повреждённый архив отвергается. Ни реальные ключи пользователей, ни сервисы отправки не вызываются.

**Инженерное доказательство:** [run #44300227602](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/44300227602) — SUCCESS, 24/24, все реальные PG17/TLS/session/webhook/restore шаги зелёные.

## Что ещё не сделано

- Подключение к настоящему проекту Supabase, реальным auth.sessions, проверенному staging host/CA и секретному хранилищу — отсутствует.
- Внешний webhook/email/SMS/push провайдер и контроль реальных согласий/очереди — не подключены.
- Полный security review реальных permissions, observability, offsite encrypted backup/restore, data retention, rollback runbook и независимая подпись artifacts — не завершены.
- Платежи, налоги, выплаты авторам и production deployment — NO_GO.

Ветка main и работающий сайт не изменялись.
