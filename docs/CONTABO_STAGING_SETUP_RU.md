# MARCOSA: подключение Contabo и запуск staging без ручного SSH при каждом релизе

Текущий статус: **код GitHub Actions установлен, но SSH-доступ и реальная установка на VPS НЕ проверены.** Никогда не направляйте это на `/opt/marcosa/current` до отдельного аудита.

## Что уже находится в GitHub

- `.github/workflows/marcosa-ssh-preflight.yml` — ручная диагностика SSH, **только чтение**.
- `.github/workflows/marcosa-staging.yml` — тесты Python/Node, сборка `dist/`, архив, staging-деплой при включённом переключателе.
- `.github/workflows/marcosa-staging-rollback.yml` — ручной откат STAGING.
- `scripts/activate-staging.sh` и `scripts/rollback-staging.sh` — атомарное переключение `current` / `previous` в домашнем каталоге пользователя `marcosa-deploy`.

## A. Прежде всего сделайте репозиторий приватным

Репозиторий `osmanosmanov6880-bot/marcosa-fusion` сейчас **Public**.
Откройте **Settings → General → Danger Zone → Change repository visibility → Private**.

Нельзя загружать оригинальные файлы MARCOSA, приватные бэкапы и прочие исходники в публичный репозиторий до проверки их на секреты и права.

## B. Первоначальная подготовка сервера

Кандидат VPS: `169.58.48.38` (`vmi3625032`). По ранее присланным снимкам **SSH root-вход здесь не подтверждён**. Перед работой сверьте в Contabo, что это действительный хост MARCOSA, а не соседняя платформа. Если SSH root не принимается, используйте доверенную консоль Contabo; не делайте переустановку VPS.

**Все команды ниже — Linux, исполняются только при приглашении вида `root@vmi...#`, НЕ в Windows PowerShell:**

```bash
hostname
id
ls -ld /opt/marcosa /opt/marcosa/site 2>/dev/null || true
id marcosa-deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" marcosa-deploy
install -d -m 700 -o marcosa-deploy -g marcosa-deploy /home/marcosa-deploy/.ssh
touch /home/marcosa-deploy/.ssh/authorized_keys
chown marcosa-deploy:marcosa-deploy /home/marcosa-deploy/.ssh/authorized_keys
chmod 600 /home/marcosa-deploy/.ssh/authorized_keys
nano /home/marcosa-deploy/.ssh/authorized_keys
```

В последнем редакторе **добавьте** строку из вашего `marcosa_staging.pub`. Не удаляйте другие доверенные ключи.

Затем в Linux:

```bash
install -d -m 750 -o marcosa-deploy -g marcosa-deploy /home/marcosa-deploy/marcosa-staging
install -d -m 750 -o marcosa-deploy -g marcosa-deploy /home/marcosa-deploy/marcosa-staging/incoming
install -d -m 750 -o marcosa-deploy -g marcosa-deploy /home/marcosa-deploy/marcosa-staging/releases
printf 'MARCOSA-STAGING-APPROVED-v1\n' > /home/marcosa-deploy/marcosa-staging/.staging-approved
chown marcosa-deploy:marcosa-deploy /home/marcosa-deploy/marcosa-staging/.staging-approved
chmod 600 /home/marcosa-deploy/marcosa-staging/.staging-approved
```

Не добавляйте `marcosa-deploy` в группы `sudo` или `docker`, не меняйте владельца `/opt/marcosa`, не пересоздавайте существующие `authorized_keys`.

## C. Проверка SSH-ключа с Windows

В **Windows PowerShell**:

```powershell
Get-Content "$env:USERPROFILE\.ssh\marcosa_staging.pub"
ssh -i "$env:USERPROFILE\.ssh\marcosa_staging" -o IdentitiesOnly=yes marcosa-deploy@169.58.48.38
```

Новый отпечаток ключа хоста сначала сверьте через независимую доверенную консоль Contabo.

Серверный публичный ключ (не пользовательский) доступен из Linux:

```bash
cat /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Формат `MARCOSA_SSH_KNOWN_HOSTS`: `169.58.48.38 ssh-ed25519 AAAA...` (полная публичная строка серверного ключа). **Один отпечаток SHA256 не подходит**. Сравните отпечаток до доверия; одного непроверенного `ssh-keyscan` недостаточно.

## D. GitHub Secrets: используйте уже созданные имена

Settings → Secrets and variables → Actions → Repository secrets:

| Secret | Значение | 
|---|---|
| `MARCOSA_STAGING_HOST` | `169.58.48.38`, только после подтверждения VPS |
| `MARCOSA_STAGING_USER` | `marcosa-deploy` |
| `MARCOSA_SSH_KEY` | Полное содержимое приватного *специального staging-ключа* на Windows |
| `MARCOSA_SSH_KNOWN_HOSTS` | Проверенная полная запись публичного ключа SSH сервера |

Приватный ключ, пароль root или токен Supabase **не присылайте в чат и не помещайте в Git**. Старые примеры секретов `MARCOSA_STAGING_KEY` и `MARCOSA_STAGING_KNOWN_HOSTS` не применяются — workflows исправлены под имена, которые уже видны на вашем скриншоте.

## E. Первый ручной тест

1. Сначала репозиторий Private.
2. В GitHub перейдите в **Actions → MARCOSA | Verify staging SSH (read-only) → Run workflow**.
3. Проверьте результат:
   - `server=...` и `connected_as=marcosa-deploy`: авторизация работает.
   - `/opt/marcosa: PRESENT`: каталог есть (но НЕ факт, что нужный домен использует его).
   - `staging_marker=PRESENT`: каталог готов для staging-релиза.
4. Если ошибка `Permission denied (publickey)` — проверять только ключ `authorized_keys`, пользователя и секрет `MARCOSA_SSH_KEY`; **не пытаться угадывать root-пароль**.
5. Если `Host key verification failed` — проверить запись `MARCOSA_SSH_KNOWN_HOSTS` и отпечаток в доверенной консоли; не отключать `StrictHostKeyChecking`.

## F. Подключение исходников R2 и запуск автосборки

После переключения repo в Private необходимо **действительно импортировать исходники из `MARCOSA_GITHUB_AUTODEPLOY_STARTER_R2.zip` как отдельные файлы**, включая `site/`, `tests/`, `tools/`, а не просто загрузить ZIP.

Только после успешного Build на `main` и SSH preflight:
- **Settings → Secrets and variables → Actions → Variables → New repository variable**
- `MARCOSA_STAGING_ENABLED=true` (до готовности оставьте `false` или не создавайте).

Успешный staging-релиз хранится в `/home/marcosa-deploy/marcosa-staging/releases/<40-hex SHA>/` с указателем `current`; откат выполняется отдельным ручным workflow.

**Это не публикация в marcosa.club.** До production нужны проверки DNS, live source SHA, Nginx, Supabase RLS, сообщений, Worlds, Creator Hub, прав на контент и резервной копии.

## G. Правила дальнейших релизов

- PR → проверка кода → merge `main` → CI → отдельный STAGING.
- Никакой публикации на production только по факту создания секретов.
- Другие продукты остаются независимыми — не смешивать их базы и права доступа с MARCOSA.
- Не сообщайте о реальных просмотрах, продажах или платежах на основании локальных тестов.
