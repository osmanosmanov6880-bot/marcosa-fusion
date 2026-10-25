# MARCOSA R91 — непрерывная публикация из main через GitHub Actions → SSH STAGING → проверенный HTTPS

## Режим и границы

После явного запроса владельца деплой изолированного **статического STAGING** переведён на `push` в `main` для изменённых файлов статического сайта и релизных сценариев. Ручной `workflow_dispatch` с подтверждением `DEPLOY-MARCOSA-STAGING` остаётся резервным путём. PR, теги, feature-ветки, scheduled events и другие репозитории не имеют доступа к SSH-выкладке. Производственное приложение, база пользователей, контур платежей и домен production не изменяются.

Контур: проверенная сборка → SHA256 tarball и независимая аттестация сборки → `marcosa-staging` GitHub environment → строгая проверка ED25519 known_hosts + независимого provider fingerprint → read-only SSH preflight → `marcosa-deploy` → атомарная активация → SSH file check → **реальный HTTPS readback с доверенным GitHub artifact digest**. При ошибке HTTPS после SSH-активации автоматически делается попытка STAGING-only rollback; если предыдущей успешной версии не существует, требуется отдельная безопасная настройка сервера. Ни зелёная сборка, ни зелёный SSH сами по себе не означают, что сайт публично доступен.

## Уже установленный внешний блокер (25 октября 2026)

GitHub Actions run #40202924258: сборка успешно завершилась, SSH шаг `Diagnose SSH...` не прошёл: `Pinned host key mismatch`. На данном этапе **никаких изменений на STAGING сервер не загружено**. Отмена проверки host key, `ssh-keyscan` без независимого подтверждения или замена учётной записи на root не допускаются.

Для снятия блокировки оператор должен зайти в панель именно своего VPS-провайдера, сопоставить имя/IP, порт и ED25519 **серверный** host-key fingerprint, затем безопасно обновить соответствующие защищённые GitHub secrets/variables. Использовать приватные ключи в переписке нельзя. На сервере должна быть создана и маркирована отдельная директория `/home/marcosa-deploy/marcosa-staging`, как требует `scripts/diagnose-staging-ssh.sh`.

## Переменные среды GitHub `marcosa-staging`

| Название | Назначение |
|---|---|
| `MARCOSA_STAGING_HOST` (secret) | Правильный изолированный VPS |
| `MARCOSA_STAGING_USER` (secret) | Только `marcosa-deploy` |
| `MARCOSA_SSH_KEY` (secret) | Только закрытый ключ именно выделенной роли |
| `MARCOSA_SSH_KNOWN_HOSTS` (secret) | Полный `ssh-ed25519` host:port pin |
| `MARCOSA_STAGING_HOST_FINGERPRINT` (secret) | Независимо проверенный отпечаток сервера |
| `MARCOSA_STAGING_PORT` (variable) | SSH port, default 22 |
| `MARCOSA_STAGING_ORIGIN` (variable) | Публичный HTTPS STAGING root без пути |
| `MARCOSA_STAGING_PUBLIC_HOST` (variable) | Отдельно проверенное DNS-имя STAGING |

GitHub environment `marcosa-staging` должен оставаться защищённым; его reviewers и правила задаёт владелец в GitHub Settings, этот репозиторий не может подтвердить их наличие программно. Когда проверка хоста и публичного HTTPS проходит, дальнейшие изменения статического сайта в `main` выкладываются автоматически. При несовпадении ключа или хэша публичных файлов публикация блокируется.

## Проверка результата

Workflow `.github/workflows/marcosa-staging.yml` должен завершить `build`, `deploy_staging` и шаг `Independently verify hosted STAGING HTTPS bytes`. Доказательство должно содержать полный `GITHUB_SHA`, `reviewedBuildManifestSha256`, три сравнения `index.html`, `network.js`, `network.css` и `verified:true`; эти значения подтверждают только **статический STAGING**, не пользовательскую API/БД/production.

Примечание об аккаунтах: репозиторий принадлежит GitHub `osmanosmanov6880-bot`; подключённый `HADJAL001` имеет к нему только чтение. Email GitHub не заменяет ни сервер, ни домен, ни права публикации.

## R92 — правильный GitHub SSH-ключ и подтверждение целевого VPS

После восстановления доступа к Contabo `vmi3625032 / 169.58.48.38` администратор создал отдельный SSH-ключ `marcosa_github_actions` от имени `marcosa-deploy`. Его закрытая часть добавлена в repository secret `DEPLOY_SSH_KEY`, а сервер хранит соответствующий публичный ключ в `authorized_keys`. Верифицируемый отпечаток публичной части: `SHA256:b6e0zrGwnTCu5yo9IZstiPw+5EGfahHgVpI3TWeccA0`.

Три SSH workflow теперь используют **только** `DEPLOY_SSH_KEY`, а не устаревший `MARCOSA_SSH_KEY`, проверяют указанный отпечаток ключа и требуют строго целевой VPS `169.58.48.38`. Старые репозиторные секреты не удалять до инвентаризации. Скрипт ручного отката также проверяет независимый `MARCOSA_STAGING_HOST_FINGERPRINT`, pinned known_hosts и целевой сервер перед любым действием.

**Для настоящего STAGING ещё необходимо**: актуальный `MARCOSA_STAGING_HOST=169.58.48.38`; независимая верификация host ED25519 fingerprint от Contabo, занесённого в secret `MARCOSA_STAGING_HOST_FINGERPRINT`; полная запись `169.58.48.38 ssh-ed25519 ...` в `MARCOSA_SSH_KNOWN_HOSTS`; заранее одобренная staging-директория с `incoming/`, `releases/`, `.staging-approved`; отдельный, действительно маршрутизируемый HTTPS STAGING с переменными `MARCOSA_STAGING_ORIGIN` и `MARCOSA_STAGING_PUBLIC_HOST`. Для этого есть штатный `scripts/bootstrap-staging.sh`. Не передавать приватные ключи, токены или содержимое секретов через чат.

Папка действующего `marcosa.club` — `/opt/marcosa/current`, она root-owned и не является данным staging релизом. GitHub pipeline до отдельного production approval **не перезаписывает** этот сайт.

Поскольку секретный deploy private key изначально создан на VPS, после проверки публикации перенесите его хранение в нормальный секрет-менеджер администратора и удалите лишний локальный приватный файл на сервере, оставив публичную часть в `authorized_keys`. Ротацию согласовывать с CI и резервным способом входа.
