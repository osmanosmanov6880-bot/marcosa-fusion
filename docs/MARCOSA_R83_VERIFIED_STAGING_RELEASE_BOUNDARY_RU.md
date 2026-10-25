> Исторический контракт R83: ручная публикация без auto-push. По новому явному запросу владельца его для изолированного STAGING заменяет R91; актуальные условия и блокеры в `docs/MARCOSA_R91_AUTO_STAGING_RELEASE_RU.md`.

# MARCOSA R83 — реальная инженерная граница STAGING и SSH

**Сфера:** только статическая сборка STAGING на `marcosa-deploy`. Это не
многопользовательский Node/Supabase social production, не публичный сайт
и не автоматическое разрешение развернуть сеть.

## Что реально изменено в коде

1. `.github/workflows/marcosa-staging.yml` по push в `main`
   **собирает и проверяет** статический bundle, но больше не выполняет SSH
   публикацию. Единственный путь к `deploy_staging` теперь — запуск
   `workflow_dispatch` на `refs/heads/main` с точной строкой
   `DEPLOY-MARCOSA-STAGING`. Это преднамеренный человеческий барьер,
   а не просьба GPT о подтверждении.
2. `ops/staging-deploy-contract.mjs` проверяет event, repo, Git ref,
   полный SHA и выбранную staging environment **до обращения к SSH ключу**.
   Даже успешный результат сообщает `productionAuthorized=false`.
3. `scripts/diagnose-staging-ssh.sh` и отдельный шаг фактической SSH-загрузки
   используют один и тот же формат **полного, непротиворечивого ED25519
   known_hosts**, привязанного к точному host:port. Удалён путь
   «получить host key по `ssh-keyscan` и принять его как исходную истину».
4. Дополнительный секрет `MARCOSA_STAGING_HOST_FINGERPRINT` должен
   содержать SHA256 fingerprint **именно host ED25519 ключа сервера**,
   независимо полученный в защищённой панели хостинг-провайдера.
   `MARCOSA_SSH_KNOWN_HOSTS` должен содержать запись
   `HOST ssh-ed25519 BASE64`, либо
   `[HOST]:PORT ssh-ed25519 BASE64` для нестандартного порта.
   Прежние форматы с одной строкой SHA256 или raw public-key теперь
   **не допускаются**. Нельзя использовать публичный ключ вашего
   входа в GitHub вместо SSH host key сервера.
5. Обе проверки вызывают уже существующий
   `ops/verify-staging-host-key.mjs` и требуют
   `StrictHostKeyChecking=yes`. Проверка ключа не доказывает,
   что он был найден в панели провайдера: этот факт документирует
   **отдельный проверяющий**, а не система.
6. После входа действуют старые условия: restricted user
   `marcosa-deploy`, приватная marker-директория, безопасная активация
   и проверка каждого файла. Рабочий bundle больше не считается
   «загруженным» лишь на основании green build.

## Как выполнить самостоятельную проверку кода

```bash
node --test ops/test/verify-staging-host-key.test.mjs ops/test/staging-deploy-contract.test.mjs
bash -n scripts/diagnose-staging-ssh.sh
```

`marcosa-r83-staging-safety.yml` проводит эти испытания в GitHub
без SSH-секретов и без сетевого подключения. В отрицательных
сценариях отказываются push, PR, чужой branch, неверный SHA,
неправильная среда, чужой host:port, отозванный и дублирующийся ED25519 pin.

## Что запрещает настоящий запуск

Если в GitHub нет актуальных `MARCOSA_STAGING_HOST`,
`MARCOSA_STAGING_USER=marcosa-deploy`,
`MARCOSA_SSH_KEY`, **полного** `MARCOSA_SSH_KNOWN_HOSTS`
и нового `MARCOSA_STAGING_HOST_FINGERPRINT` (с фактом независимой
верификации), SSH deployment по определению заблокирован.

Нельзя записывать сюда реальные секреты, private key, user PII.
Нельзя ослаблять `StrictHostKeyChecking`, доверять первому
`ssh-keyscan` или помечать отсутствие staging как «условно пройдено».
Рабочий HTTPS адрес, права файлов на удалённом сервере и реальный
успешный откат должны быть проверены после явного человеческого
разрешения staging deployment.

**Дополнительная проверка совместимости (2026-10):** Supabase
объявил отказ от четырёх устаревших TLS 1.2 CBC suites
не раньше 10 ноября 2026 года. Для будущего Auth/Data API/Storage
нужно тестировать TLS 1.3 или современный AEAD TLS 1.2
на целевых клиентах. Эта мера здесь **не проверялась**,
так как подключённых Supabase проектов сейчас нет.

## Окончательный критерий R83

Доказательство доверенного host key от провайдера +
явно одобренные staging secrets/permissions +
успешный *реальный* staging deploy и rollback по точному main SHA +
проверенный изолированный HTTPS, без разглашения секретов.

**Пока этот критерий не выполнен, R83 называется «кодовая готовность
и сухой прогон», не «развёрнут в мире».** Эта граница сохраняется
для R84–R90 и Issue #55.
