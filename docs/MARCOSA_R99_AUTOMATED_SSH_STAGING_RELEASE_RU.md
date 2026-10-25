# MARCOSA R99 — непрерывная проверенная доставка на Contabo (SSH-only STAGING)

## Что подтверждено

- Пользователь сервера `marcosa-deploy` (не root).
- VPS Contabo `vmi3625032`, `169.58.48.38`, порт SSH 22.
- Публичный **host** ED25519 зафиксирован отдельно от приватного **deploy** ключа; секрет `DEPLOY_SSH_KEY` никогда не читается из исходников.
- [GitHub run #40231543130](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40231543130) подтвердил прямую SSH-передачу, активацию и проверку файлов в `/home/marcosa-deploy/marcosa-staging/current` для исходного коммита `54bff8c46e4fb285dff5fbd39422ab84f85a87ff`.
- Публичный `https://marcosa.club` остался неизменён: его Nginx-корень `/opt/marcosa/current` принадлежит root и содержит отдельную работающую платформу, а не только статический preview.

## Схема R99

Для **каждого** нового push в `main` (или явного ручного запуска с подтверждением `DEPLOY-MARCOSA-STAGING`):

1. `build`: устанавливает закреплённые версии Python/Node/Pillow, собирает два оригинальных cinema-эпизода из фиксированных SHA и запускает Python + JavaScript тесты.
2. Формируется изолированный статический `dist/`. Создаётся `staging-release.json` с полным SHA коммита и SHA-256 build-manifest. Бандл загружается в GitHub Actions Artifact с именем `marcosa-site-<этот_SHA>`.
3. `deploy_ssh_filesystem`: скачивает **именно артефакт текущего run**; проверяет checksum и provenance. Другую сборку или неподтверждённую ветку скрипт отклоняет.
4. `ops/ssh-stage-verified.sh`: аутентифицирует ключ только под `marcosa-deploy`, проверяет host pin и VPS, проверяет подготовленную STAGING-папку, передаёт архив через SCP и атомарно переключает `current` на `releases/<этот_SHA>`.
5. По отдельному SSH-подключению сравнивает **все файловые SHA-256** с доверенным build-manifest; не только `index.html`, `network.js` и `network.css`. При ошибке запускается ограниченный staging-only rollback (когда есть предыдущий проверенный релиз). В summary выводится `PUBLIC_HTTPS_VERIFIED=NO`.
6. `deploy_staging` (отдельная публичная проверка) запускается **только при наличии** согласованных переменных `MARCOSA_STAGING_ORIGIN` и `MARCOSA_STAGING_PUBLIC_HOST`, и после удачного SSH-этапа. При отсутствии переменных основная SSH-доставка **выполнена**, но публичную STAGING-публикацию нельзя утверждать.

## Безопасность

- `StrictHostKeyChecking=yes`; ключ сервера проверяется по подписанному для проекта pin-файлу `ops/ssh/marcosa-staging-known-hosts` и подтверждённому отпечатку. Ни `ssh-keyscan` как источник доверия, ни `root` в Actions.
- Публичный предпросмотр *не* равен полной живой платформе с учётными записями, Auth, Supabase, платежами или внутренними API.
- `/opt/marcosa/current`, Nginx, DNS, базы и пользовательские данные не меняются.
- Старый R98 pinned-artifact workflow сохранён исключительно для **ручного аварийного** повторного размещения конкретного исторического артефакта и не срабатывает по push.
- Атомарное повторное активирование текущего SHA сохраняет старую ссылку `previous`; новый SHA сохраняет прошлую версию для отката.

## Что останется перед прямым включением основного домена

Сделать отдельный публичный staging-host с HTTPS, указать его в GitHub Variables и проверить чтение реально размещённых байтов по HTTPS. Затем нужен самостоятельный **production migration**: инвентаризация исходного сайта `/opt/marcosa/current`, сервисов, авторизации, данных и совместимости с GitHub static preview. **Нельзя** без такого плана просто заменить действующую папку содержимым static preview или передать CI права root.

## Ссылки

- [R98 — подтверждённый SSH-деплой](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40231543130).
- [Текущая автоматическая цепочка](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-staging.yml).
- [Инструкция по возвращению предыдущего STAGING](https://github.com/osmanosmanov6880-bot/marcosa-fusion/blob/main/scripts/rollback-staging.sh).
