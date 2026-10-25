# MARCOSA R120 — автономный сторож публичной legacy-платформы

## Зачем

R118 **на настоящем VPS** выявил несовместимость действующего `marcosa.club` с отдельным статическим preview. R120 автоматически контролирует, не поменялся ли безопасно утверждённый **ограниченный публичный отпечаток** прежнего сайта, пока новая платформа проходит разработку. Он **не** исправляет несовместимость и **не** даёт разрешение на production cutover.

Исторический доказанный источник: [R118 #40244992341](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40244992341), exact `main=5a5111d01bfb55509ea634509c1170997a16a329`.

| Действующий production: проверенная публичная база | Значение |
| --- | --- |
| SHA-256 **публичного index.html** | `33d79f35b6d4873113cab99575606e5700802c0d0720eefd4604d49fe08aa9b3` |
| Число публичных файлов верхнего уровня | 34 |
| Критические имена файлов | `developer-console.js`, `interaction-bridge.js`, `marcosa-config.js`, `marcosa-supabase.js`, `nexus.js` |
| Файлов только прежней платформы на момент R118 | 33 |
| Модулей прежней платформы, отсутствовавших в preview | 5 |
| Production deployment permission | **NO_GO** |

## Как работает R120

1. Только успешный `R118` на актуальном SHA `main` активирует workflow `marcosa-r120-legacy-root-guard.yml`. На PR — только автономные тесты, без доступа на сервер.
2. Workflow с правами GitHub `contents: read` и `actions: read` скачивает **только сохранённый JSON-отчёт** успешного конкретного R118 из GitHub Actions.
3. Скрипт `ops/r120_legacy_root_guard.mjs` требует точный SHA, неизменённые флаги `R117=PASS`, `R118=PASS`, `productionDecision=NO_GO` и `productionChanged=false`. Поддельные или устаревшие доказательства отклоняются.
4. Сравниваются SHA-256 старого публичного index.html, число публичных файлов верхнего уровня и наличие пяти известных критических модулей.
5. Если что-то изменилось, выводится `R120_LEGACY_PUBLIC_FINGERPRINT=DRIFT`, workflow падает, но публикует отдельный **санитизированный** JSON с конкретными причинами. Если всё совпало, результат `PASS`.
6. В обоих случаях `productionCutoverAuthorized=false`, `productionModified=false`, `verdict=NO_GO`. R120 не выполняет SSH, API-записи, Nginx, DNS, SQL, миграции и даже не читает production напрямую.

## Как интерпретировать PASS

**PASS НЕ означает, что все 34 файла идентичны побайтно.** R118 предоставляет SHA только публичного индекса; остальные файлы проверяются лишь по количеству и существованию пяти имён. Отдельный старый JS может измениться, и R120 не узнает об этом. Поэтому отчёт всегда содержит `productionFullyByteVerified=false`, `databaseOrUserMigrationVerified=false` и `legacyPublicRootReplacementAllowed=false`.

Ранее недоступные старому предпросмотру модули могут быть легально реализованы в новой версии, не меняя прежнюю: R120 допускает изменение **preview** manifest. Но без трассировки Auth/cookies/JS API и реальных пользовательских сценариев замена production по-прежнему запрещена.

## Приёмка

- `node --test tests/r120_legacy_root_guard.test.mjs`: добросовестный PASS, дрейф индексного SHA, количества, отдельного legacy-модуля, устаревший коммит, поддельные права, неверные имена/счётчики, отказ от произвольных файлов и от SSH.
- R120 PR не объявляется проверенным до отдельного CI.
- Post-merge `workflow_run` на текущем `main` должен прочесть свежий R118, выдать собственный лог и загрузить независимый JSON артефакт.

## Последующие блокеры

Дальше необходимы [Issue #135 — совместимость](https://github.com/osmanosmanov6880-bot/marcosa-fusion/issues/135), R119 (настоящий disposable VPS Node/SQLite social smoke), инвентаризация существующих Auth/Postgres/Storage и проверенный backup/restore реальных систем. Статический GitHub Pages остаётся **отдельным origin**, а `marcosa.club` не перезаписывается.
