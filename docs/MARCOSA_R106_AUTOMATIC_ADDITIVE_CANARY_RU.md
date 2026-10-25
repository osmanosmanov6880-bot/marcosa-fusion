# MARCOSA R106 — автоматические обновления только нового раздела /network-os/

## Что реально уже подтверждено

GitHub Actions [#40235059562](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40235059562) проверил 62/62 публичных HTTPS-файла GitHub Pages с SHA-256 и завершился SUCCESS. Отдельно [#40235059568](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40235059568) успешно доставил ту же ветку в изолированную папку на VPS Contabo. Это два самостоятельных пути публикации статического предпросмотра.

На `marcosa.club` до сих пор работает оригинальное приложение в `/opt/marcosa/current`. **Нельзя менять его основную папку или Auth.**

## Доставка R106

Добавлены:
- `ops/promote_canary_from_staging.py` — непривилегированный издатель нового раздела в выделенную `/var/www/marcosa-network-os/releases/<SHA>`;
- `ops/verify_canary_live_https.mjs` — независимая проверка HTTPS `https://marcosa.club/network-os/` для **всех** статических файлов из доверенного манифеста, без произвольных адресов и редиректов;
- `ops/ssh-stage-verified.sh` — запускает root-gated canary promotion **только после успешных SSH SHA256 + local HTTP проверок**;
- `tests/test_promote_canary.py` и `tests/canary-live-https.test.mjs` — реальные локальные тесты атомарной замены/отката и сетевой проверки на mock-HTTP;
- `.github/workflows/marcosa-r106-canary-contract.yml` — быстрые автономные CI-тесты.

## Как работает безопасный переключатель

1. Пока root-администратор **не выполнил R105 one-time установку**, отдел `/var/www/marcosa-network-os` отсутствует, скрипт возвращает `NOT_INSTALLED`; обычный SSH-деплой продолжает успешно работать.
2. После успешной административной установки R105 root-owned маркер появляется **в самом конце**, после `nginx -t`, reload и подтверждения реального HTTPS. До этого GitHub Actions не может публиковать на основном домене.
3. Следующий проверенный push в `main` создаёт новый каталог исключительно внутри `/var/www/marcosa-network-os/releases`, копируя только перечисленные в manifest файлы. Выполняется атомарное переключение canary `pointers/current`, а предыдущий релиз сохраняется.
4. GitHub затем читает все новые ресурсы публично по `https://marcosa.club/network-os/` и сверяет их с **тем же** manifest и SHA-256 текущего коммита.
5. При нарушении HTTPS-контракта делается rollback **только canary-ссылки**, не STAGING, не `/opt/marcosa/current`, не Nginx, не БД.
6. После удаления root canary Nginx include через R105 rollback остаётся root-owned маркер `DISABLED`. Автоматическая доставка canary перестаёт запускаться, но STAGING продолжает работать.

## Границы доказательств

Код может подготовить и автоматизировать всё, что разрешено SSH-пользователю `marcosa-deploy`, но **не способен самостоятельно совершить первое root-controlled изменение Nginx**, поскольку этот ключ преднамеренно не имеет таких полномочий. Нельзя утверждать, что `https://marcosa.club/network-os/` доступен, пока не проведены реальная установка и внешний HTTPS-readback.

GitHub Pages остаётся рабочим публичным предпросмотром независимо от этого административного шага.
