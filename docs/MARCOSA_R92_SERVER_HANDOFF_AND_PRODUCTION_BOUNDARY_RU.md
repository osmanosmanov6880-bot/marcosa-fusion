# MARCOSA R92 — передача SSH и ограничение реального деплоя

## Установлено по проверкам владельца 25 октября 2026

- Правильный VPS: Contabo `vmi3625032`, адрес `169.58.48.38`.
- Действующий сайт: `https://marcosa.club/`, Nginx использует `/opt/marcosa/current` (каталог root-owned, не symlink).
- `/opt/marcosa/releases` существует, но на момент диагностики пуст. У `marcosa-deploy` нет прав записи в `/opt/marcosa`. Не делайте `chown -R` на production без отдельного change plan.
- От имени `marcosa-deploy` ранее создан резервный архив текущей версии в домашней папке, а также создана новая пара SSH `marcosa_github_actions`.
- Новый GitHub Actions secret: `DEPLOY_SSH_KEY`. Подтверждённый публичный отпечаток `SHA256:b6e0zrGwnTCu5yo9IZstiPw+5EGfahHgVpI3TWeccA0`.
- Последняя автоматическая сборка `main` проходила, SSH deployment был остановлен на проверке `MARCOSA_STAGING_HOST_FINGERPRINT`. Нельзя называть её успешно опубликованной.

## Последовательность публикации

1. Сначала отдельный статический STAGING `/home/marcosa-deploy/marcosa-staging/releases/<SHA>` с активным символическим указателем, SHA-256 и root-independent переключением.
2. До запуска pipeline проверить host ED25519 fingerprint из доверенной консоли сервера Contabo и сохранить его в `MARCOSA_STAGING_HOST_FINGERPRINT`; при установленной записи `MARCOSA_SSH_KNOWN_HOSTS` они обязаны совпасть. **Не использовать слепой ssh-keyscan**.
3. Выполнить штатное bootstrap создание отдельного staging-каталога после разрешения владельца и настройки публичного тестового HTTPS-адреса. До публичного HTTPS readback pipeline обязан сообщить BLOCKED.
4. Только отдельный production release plan должен сравнить текущий legacy `/opt/marcosa/current` с GitHub source preview: API, маршруты, конфигурация Supabase, Nginx, статические asset paths, конфигурация авторизации и откат. Нельзя заменить динамический сайт целиком статическим preview без доказанной совместимости.

## Критерий настоящего успеха

- `build:success` — только проверенная сборка.
- `deploy_staging:success` вместе с `verified:true` публичных HTTP-байтов — подтверждённая публикация только STAGING.
- Проверка production и переключение `marcosa.club` требуют отдельной авторизации и смоук-тестов. Вплоть до этого `productionAuthorized=false`.

**Запрещено:** копировать закрытый SSH-ключ или приватные сертификаты в репозиторий, пересылать их в чат, отключать StrictHostKeyChecking, выполнять `rsync --delete` в `/opt/marcosa/current`, удалять старый working webroot или использовать root для GitHub CI.

## R96 — подтверждённый публичный SSH host key без Secrets

Из read-only GitHub Actions №40230935394 получена полная строка публичного ключа, причём сначала SHA256 проверен против отпечатка из Contabo-консоли владельца. Для защиты от ошибок OCR значения закреплены в git:

- `ops/ssh/marcosa-staging-known-hosts`: полная, точная строка для `169.58.48.38`.
- `ops/load-pinned-staging-host.sh`: проверка полного host:port, ED25519 и независимо закреплённого SHA256 `3VwLDjaMbBL/0AkWPjvaJo0gF1wRk/6g+ZJze+5toZA` без доступа к сети/TOFU.
- В трёх SSH workflows перед подключением вызывается loader; неверные старые secrets `MARCOSA_SSH_KNOWN_HOSTS` и `MARCOSA_STAGING_HOST_FINGERPRINT` больше не используются для SSH-подключения. Это **только публичный ключ сервера**, а не приватный ключ пользователя. `DEPLOY_SSH_KEY` остаётся закрытым секретом.

STAGING marker, incoming/releases и независимо опубликованный STAGING HTTPS остаются обязательными. Если их нет, деплой закономерно остановится на следующей проверке. Нельзя говорить, что публичный production уже обновлён.
