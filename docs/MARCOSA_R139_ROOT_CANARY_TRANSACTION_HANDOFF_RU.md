# MARCOSA R139 — транзакционный root-gated canary, строгий SHA и ручная публикация

**Область:** статический preview `/network-os/` как ДОБАВОЧНЫЙ маршрут. Основной `marcosa.club`, `/opt/marcosa/current`, приватные аккаунты, Supabase, DNS и другие приложения не заменяются. **Production GO = NO.**

## Зафиксированная проблема

В первоначальном `ops/install_production_canary.py` первый `nginx -t`, reload, публичная HTTPS-проверка и сверка исходного index.html защищались откатом. Однако **запись `active.json` и корневого `.canary-approved` происходила уже после `try/except`**. Сбой диска/прав/системного вызова в финальном шаге оставлял Nginx изменённым при неполном состоянии. Теперь оба шага находятся в единой rollback-границе.

Отказы при записи/изменении режима финальных файлов должны восстановить исходный Nginx, отключить approval marker, убрать ошибочный активный state. Root backup и unapproved sidecar для расследования сохраняются. Если восстановление Nginx само терпит неудачу, state остаётся для администратора, а маркер снимается; никакого ложного автоматического продвижения.

## Двойной SHA guard

Оператор должен иметь **ДВА независимо установленных значения**:
- `CONFIG_SHA`: SHA256 именно проверенного /etc/nginx/sites-available/marcosa, подтверждённого текущим read-only аудитом — нельзя брать только из непроверенной инструкции;
- `RELEASE_SHA`: 40-значный SHA принятого GitHub main, который одновременно наблюдается в `/home/marcosa-deploy/marcosa-staging/current` как `releases/$RELEASE_SHA`.

`plan` требует `--expect-config-sha256`; `apply` дополнительно **обязательно** требует `--expect-source-sha`. В `apply` проверяются both approved SHA from `do_plan` and again `verify_stage` immediately before copying bytes. Если текущая версия сменилась — отказ. Никакого silent "latest" или подмены на старый артефакт.

## Установка для уполномоченного администратора (не для GitHub deploy-user)

На **самом** ожидаемом сервере под обычным администратором предварительно выполнить `hostname`, проверить владельца конфигурации, получить точный checked-out source SHA из доверенного GitHub. Клонировать/проверить коммит по заранее согласованному `RELEASE_SHA`, не выполнять произвольные команды из сторонних источников.

```bash
git rev-parse HEAD
readlink /home/marcosa-deploy/marcosa-staging/current
sha256sum /etc/nginx/sites-available/marcosa
```

Сверить конфигурационный digest с **независимой read-only проверкой** и указать его вручную как `CONFIG_SHA`. Проверить, что `RELEASE_SHA` совпадает с текущей рабочей копией main и с deployed staging symlink.

Сначала **только план** (не меняет конфигурацию):

```bash
python3 ops/install_production_canary.py plan --expect-config-sha256 "$CONFIG_SHA"
```

Проверить JSON: `sourceSha == RELEASE_SHA`, `rootReplacementAllowed == false`, `stagingAssetsVerified > 0`. Проверить независимую браузерную политику изоляции данных ниже. Только после этого администратор может вручную подтвердить изменение:

```bash
sudo python3 ops/install_production_canary.py apply --expect-config-sha256 "$CONFIG_SHA" --expect-source-sha "$RELEASE_SHA" --confirm MARCOSA-ADD-ONLY-CANARY
```

Перед `apply` снова проверить source SHA: код защищает от смены STAGING, но администратор должен сам проверить подлинность и актуальность исходников. После установки независимо запросить `https://marcosa.club/network-os/`, сравнить опубликованные байты и подтвердить сохранность старой главной страницы. При проблеме **только ручной root-rollback добавочного раздела**:

```bash
sudo python3 ops/install_production_canary.py rollback --confirm MARCOSA-REMOVE-ONLY-CANARY
```

Если установка остановилась без `active.json`, НЕ пытаться запускать rollback вслепую: Nginx уже должен быть восстановлен, а root backup и неактивный sidecar оставлены для проверки. Не удалять их до выяснения причины.

## Обязательный отдельный браузерный контроль перед root apply

У превью есть `localStorage` (`social-core.js`, `social-journal.js`, `social-transfer.js`) и `IndexedDB` (`creator-vault.js`). **URL-путь `/network-os/` на том же домене НЕ изолирует хранилище браузера от старой MARCOSA**. Без доступа к исходникам старой платформы нельзя гарантировать отсутствие конфликтов ключей, cookie или сессий. Перед публикацией на основном origin нужна проверенная модель изоляции — например, отдельный HTTPS-origin/subdomain с собственными host-only cookies и тестами либо доказанный безопасный sandbox. Нельзя считать это закрытым только из-за успешной статической SSH и HTTPS-проверки.

## CI

`tests/test_r139_canary_atomicity.py` имитирует успешный HTTPS, сбой записи `active.json`, ошибку записи/прав маркера и устаревший SHA без реального root/SSH. R105/R106 workflow запускают эти проверки только над временными папками. Даже все зелёные тесты здесь НЕ означают, что маршрут установлен.

## Остальные обязательные выпускные барьеры

Для полной замены `marcosa.club` дополнительно нужны legacy source + route/Auth compatibility, реальный доступ к Supabase, резервная копия и восстановление Auth/PG/Storage, реальные JWT/RLS двух пользователей, ручные R132/R117/двойные R118/R121/R122/R127 и письменное одобрение владельца. Пока всё это не подтверждено — **NO_GO**.
