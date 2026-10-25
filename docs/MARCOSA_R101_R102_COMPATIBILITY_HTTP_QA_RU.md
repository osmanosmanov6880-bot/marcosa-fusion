# MARCOSA R101–R102 — проверка совместимости и реальный HTTP-QA на VPS

Дата: 25 октября 2026. Источник: `osmanosmanov6880-bot/marcosa-fusion`.

## Почему нельзя просто заменить существующий сайт

Проверка R100 на Contabo `169.58.48.38` доказала, что действующая главная страница `/opt/marcosa/current/index.html` и статический публичный предпросмотр, собираемый GitHub, **не идентичны**. В существующем сайте находятся `marcosa-config.js`, `marcosa-supabase.js`, `interaction-bridge.js`, `developer-console.js` и `nexus.js`, а также отдельные подкаталоги. Перезапись корня новым предпросмотром без миграционного проекта может выключить авторизацию и старые пользовательские процессы.

## R101 — реальный read-only отчёт совместимости

Рабочие файлы:

- `tools/production_parity_audit.py`
- `tests/test_production_parity_audit.py`
- `.github/workflows/marcosa-r101-production-parity.yml`

GitHub Action подключается по проверенному SSH как `marcosa-deploy` и **только читает** старый индекс, публичные имена файлов верхнего уровня, staged `index.html`, `build-manifest.json` и `staging-release.json`. Она не экспортирует содержимое живого сайта, пользовательские данные, конфигурации подключения, токены, БД или закрытые переменные.

Отчёт содержит контрольные суммы страниц, разницы общих и отсутствующих файлов, проверку локальных ссылок и список известных legacy интеграционных JavaScript-файлов. Его вывод неизменно содержит `productionAuthorized:false`, `directRootReplacementAllowed:false`. Таким образом даже совпадение двух `index.html` не означает автоматического разрешения боевого релиза.

## R102 — временный HTTP-сервер без внешних портов

Рабочие файлы:

- `ops/loopback_staging_http.py`
- `tests/test_loopback_staging_http.py`
- `ops/ssh-stage-verified.sh` (выполняет smoke **после** загрузки и SHA-проверки файлов).

Скрипт под непривилегированным пользователем открывает временный HTTP-сервер **строго на 127.0.0.1** и на динамическом порту внутри VPS. Он HTTP-запросами проверяет каждое содержимое из доверенного `build-manifest.json`, SHA-256 и базовые MIME-типы; запрет каталогов и путь вне manifest; завершается и закрывает сервер. Это подтверждает реальную отдачу ресурсов ОС, но **не** публичный HTTPS. При отказе GitHub Actions помечает стадию ошибкой и предпринимает ограниченный откат STAGING.

Ни один процесс не получает `root`, не переписывает Nginx и не выдаёт локальный веб-сервер в интернет.

## Критерии следующего этапа

1. `R101` выполняется на VPS и сохраняет scrubbed результат, по которому можно планировать миграцию.
2. `R102` проходит все автономные тесты и первый реальный SSH-деплой, лог содержит `VPS_LOOPBACK_HTTP=PASS` и `VPS_HTTP_FILES_VERIFIED=<количество из манифеста>`.
3. Вне STAGING не изменены файлы `/opt/marcosa/current`, приватные Supabase-таблицы, домен и Nginx.
4. Настоящий cutover в production до отдельных архивирования, проверки API/сессий/БД и готового root-controlled отката **не разрешён**.

[Список запусков Actions](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions) · [Основной автоматический релиз](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-staging.yml)
