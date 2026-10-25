# MARCOSA R103 — проверенная публичная выдача GitHub Pages

Цель: после успешной сборки и deployment GitHub Pages независимо подтвердить по реальным публичным HTTPS-ответам, что опубликованные `62+` статических ресурсов совпадают по SHA-256 с **тем же GitHub Actions build-manifest.json**, из которого сформирован Pages deployment.

Проверяемый адрес: [публичный предпросмотр MARCOSA](https://osmanosmanov6880-bot.github.io/marcosa-fusion/). Это отдельное публичное приложение, не основной `https://marcosa.club/`.

## Что добавлено

- `ops/pages-live-readback.mjs`: доверенный домен `osmanosmanov6880-bot.github.io` и путь `/marcosa-fusion/` зафиксированы в коде; никаких произвольных хостов или IP.
- `tests/pages-live-readback.test.mjs`: автономные тесты на реальные SHA-256, устаревший JavaScript, подменённый манифест, неверный commit SHA и редиректы.
- `.github/workflows/marcosa-public-pages.yml`: новая последовательность `verify-and-build → publish → verify-public-bytes`. Доверенный manifest передаётся не с удалённого сайта, а как артефакт **того же** workflow-run.
- До 4 параллельных GET-запросов по HTTPS, строгие ограничения размера, MIME и отсутствия редиректа; проверка HTML, JavaScript, CSS, SVG, WebP и других разрешённых ресурсов из manifest.
- При задержке CDN выполняются ограниченные повторные попытки. Сбой проверки возвращает `failure`, а не фиктивный зелёный отчёт.
- Результат `PUBLIC_GITHUB_PAGES_READBACK=PASS` даёт факт **публичной статической публикации**, но `productionAuthorized:false`: нет доказательств серверной авторизации, Supabase, платежей, пользовательских аккаунтов или миграции оригинального MARCOSA.

## Дальнейшая граница

Пока основной `marcosa.club` использует `/opt/marcosa/current` и имеет собственные интеграционные модули, нельзя копировать в него GitHub Pages preview вместо старого сайта. Релизная цепочка и публичные предпросмотры могут развиваться автоматически, но production-перенос потребует совместимой архитектуры, подтверждённой резервной копии и отдельного механизма root-controlled активации/отката.
