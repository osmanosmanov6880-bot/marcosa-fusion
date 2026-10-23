# MARCOSA R6 — рабочая схема публикации и устранения ошибок

**Состояние проекта:** `marcosa-fusion` — публичный репозиторий с изолированным HTML/CSS/JS-превью MARCOSA R5. Это **не** полный продакшен `marcosa.club`. Пользовательские Worlds, данные Supabase, сообщения и коммерческий биллинг не входят в сборку.

## 1. Почему ранее не работало

Старые GitHub Actions имели блокировки, с которыми SSH-ключи никак не связаны:

- `marcosa-public-pages.yml` пропускал реальную публикацию, если не существовало `MARCOSA_PUBLIC_PAGES_ENABLED=true`.
- `marcosa-staging.yml` и `marcosa-ssh-preflight.yml` запрещали SSH для всех публичных репозиториев. Все задания staging завершались как `skipped`, **даже если секреты были правильными**.
- `marcosa-staging.yml` дополнительно требовал переменную `MARCOSA_STAGING_ENABLED`.
- GitHub Pages требует разовой настройки **Settings → Pages → Source: GitHub Actions**. Ключ SSH и переменные эту настройку не заменяют.

## 2. Что делает R6

| Канал | Источник | Где лежит результат | Ключи | Статус и ограничения |
|---|---|---|---|---|
| Public preview GitHub Pages | `main` | GitHub Pages | Не нужны | Автопубликация после включения Pages в настройках |
| SSH preflight | `main` | Только логи Github Actions | Приватный staging SSH + pinned host key | Строго только чтение, подтверждает подлинную SSH-авторизацию |
| Staging deployment | `main` | `/home/marcosa-deploy/marcosa-staging/current` | Те же защищённые secrets | Без root, отдельная директория, SHA-256, атомарное переключение, rollback |
| Production `marcosa.club` | Отдельный проверенный production pipeline | Не изменяется R6 | Не использовать staging secrets | До аудита текущего приложения/данных отключено |

**Public repository не требует отключать сам SSH-деплой**, если приложение разворачивается в изолированный staging, workflow допускает только доверенную ветку, а секреты и deployment environments защищены. Главное — не смешивать код из pull request с credentials. Никогда не делать deploy для PR из fork.

## 3. GitHub Pages: самый простой публичный запуск

Открой:
`https://github.com/osmanosmanov6880-bot/marcosa-fusion/settings/pages`

1. Найди **Build and deployment → Source**.
2. Выбери **GitHub Actions**.
3. Открой `Actions → MARCOSA | Publish public Network OS preview`.
4. Запусти **Run workflow** из `main` (или сделай новое изменение в `site/`).
5. Должны пройти `verify-and-build` и `publish`; в последнем будет URL публичного сайта. Ожидаемый адрес для стандартного Pages-репозитория: `https://osmanosmanov6880-bot.github.io/marcosa-fusion/` (реальную доступность проверить после выпуска).

Если `Configure Pages` выдаёт ошибку: сначала проверить Source, затем репозиторные Settings → Actions → Workflow permissions, ограничения организации и protection rules для `github-pages`.

GitHub Pages **не** даёт серверный API, БД, платежи или пользователей; только публичную статическую демонстрацию.

## 4. Contabo: точная диагностика SSH без запроса паролей

Проверяющий workflow: `Actions → MARCOSA | SSH preflight / safe connection check`. После merge R6 он запускается на `main` автоматически (или вручную), **не записывая ничего на VPS**.

Секреты **Settings → Secrets and variables → Actions → Repository secrets**:

| Имя | Назначение |
|---|---|
| `MARCOSA_STAGING_HOST` | IP или домен именно того Contabo VPS, который выбран для MARCOSA staging |
| `MARCOSA_STAGING_USER` | `marcosa-deploy`, не `root` |
| `MARCOSA_SSH_KEY` | Полный закрытый ключ *marcosa_staging*, а не `.pub`, без пароля |
| `MARCOSA_SSH_KNOWN_HOSTS` | Полная **проверенная** запись хост-ключа `IP ssh-ed25519 AAAA...` |
| `MARCOSA_STAGING_PORT` | Необязательная Actions Variable, по умолчанию `22` |

Важно: ранее в переписке фигурировали разные Contabo VPS и ошибки авторизации. **Не стоит считать `169.58.48.38` правильным сервером без независимой проверки** через собственный Contabo кабинет. На `207.180.248.95` ранее был обнаружен отдельный OSGARD; его приложения не должны затрагиваться деплоем MARCOSA.

Диагностика выдаёт понятные статусы:

| Ошибка | Значение | Следующее действие |
|---|---|---|
| `PUBLIC_KEY_AS_PRIVATE` | В SSH secret скопирован публичный ключ | Внести полный закрытый ключ в GitHub secret |
| `INVALID_PRIVATE_KEY` | Формат/строки ключа или passphrase неверны | Проверить `ssh-keygen -y -f <keyfile>` локально; секреты никому не показывать |
| `INVALID_KNOWN_HOSTS` | Введён отпечаток вместо полной записи | Получить полную запись из проверенной Contabo консоли |
| `HOST_NOT_PINNED` | Запись от другого IP или SSH-порта | Сверить хост и порт; проверить отпечаток независимо |
| `HOST_KEY_MISMATCH` | Сервер ответил другим ключом | Сверить его через Contabo, не отключать строгую проверку |
| `SSH_NETWORK` | Порт недоступен | Проверить IP/фаервол/sshd/VPS |
| `SSH_AUTH_DENIED` | Сервер отверг user/key | Установить staging *публичный* ключ в `authorized_keys` именно `marcosa-deploy` |
| `STAGING_UNPREPARED` | SSH работает, но нет нужной директории/маркера | Однократно выполнить bootstrap на выбранном VPS |
| `MARCOSA_DEPLOY_PREFLIGHT=PASS` | Ключ принят и staging подготовлен | Можно автоматически загрузить R6 в staging |

**В переписку не вставлять приватные ключи, .env, пароли, токены, дампы пользователей.**

## 5. Однократная подготовка VPS (только если preflight выявил проблему)

Не пытайся писать `useradd` в Windows PowerShell — команда Linux исполняется только в терминале VPS после появления приглашения `root@...#`.

1. Открой **Contabo → нужный VPS → VNC Console** и получи root shell *своего* сервера.
2. Сверь `hostname` и IP с `MARCOSA_STAGING_HOST`.
3. Размести *публичный* ключ `marcosa_staging.pub` в `/root/marcosa_staging.pub`; это не секрет.
4. Скопируй проверенный скрипт `scripts/bootstrap-staging.sh` из данного репозитория на VPS, прочитай его.
5. Запусти: `bash bootstrap-staging.sh /root/marcosa_staging.pub`. Он создаёт **только** `marcosa-deploy`, `authorized_keys` и его staging-папки. Не меняет root SSH, Nginx, Docker, Supabase и production.
6. Проверь `STAGING_BOOTSTRAP=OK`, затем перезапусти GitHub preflight.

**Не переустанавливай VPS и не сбрасывай credentials сервера из-за ошибки SSH.**

## 6. Защита GitHub Secrets

- В **Settings → Environments** открой или создай `marcosa-staging`.
- Добавь protection rule, допускающий деплой только из `main`, и при необходимости required reviewer.
- Защити `main` от принудительных push, требуй review перед внесением изменений в `.github/workflows/`.
- Предпочтительно затем перенести приватный ключ в *Environment secrets* вместо общих Repository secrets. При переносе убедись, что preflight workflow тоже использует это окружение; пока он читает существующие Repository secrets.
- Никаких сервисных JWT Supabase или root credentials в публичный source.
- GitHub Pages публикует только 8 статических файлов, манифест, без секретов.

## 7. Что значит успешный staging

При каждом push `main` GitHub Actions:
- проводит тесты и safety audit;
- строит воспроизводимое `dist/`;
- собирает `marcosa-site.tar.gz` + SHA256;
- проверяет SSH, пользователь, host fingerprint и marker;
- копирует архив в изолированный `incoming/`;
- проверяет SHA256 и безопасно распаковывает его;
- атомарно обновляет `current`, запоминая `previous`;
- сверяет ссылку current и наличие HTML/CSS/JS/manifest, при проблеме пытается вернуть прежнюю версию.

**Это staging-развёртывание файлов, а не факт публичного HTTP-доступа по домену.** Включать Nginx/vhost можно лишь после проверки точной привязки и соседних сайтов. Подмена действующего `marcosa.club` предпросмотром запрещена.

Для ручного отката: **Actions → MARCOSA | Roll back STAGING → Run workflow → confirmation `ROLLBACK-STAGING`**. Только если уже есть предыдущая успешная версия.

## 8. Контроль готовности R6

1. Подтверждён **реальный public URL** с загружаемыми `stories.html`, `stories.js`, `stories.css`.
2. Статус SSH preflight: **PASS** с ожидаемым hostname.
3. Deploy workflow: успешная SHA-проверка, активная staging-версия.
4. На VPS нет изменений в OSGARD, прочих приложениях, БД, production Nginx и `/opt/marcosa`.
5. Если что-то заблокировано настройкой GitHub Pages, отсутствием пользователя или несовпадением host pin — зафиксирован **конкретный технический blocker**, а не объявлен ложный успешный deploy.

