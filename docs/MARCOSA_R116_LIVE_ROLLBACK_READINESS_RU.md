# MARCOSA R116 — живой read-only аудит возможности отката на Contabo

## Зачем это нужно

В R115 откат STAGING стал допускаться только на проверенную предыдущую сборку: он повторно сверяет manifest, источник и SHA-256 каждого файла, не принимая один лишь существующий `index.html` за гарантию восстановления. R115 проверен на девяти отдельных сценариях настоящего Bash.

**R116 добавляет реальное доказательство с VPS, без выполнения отката.** Это позволяет узнать, доступна ли проверенная предыдущая версия *сейчас*, а не только в искусственном тесте.

## Изменения

- `scripts/rollback-staging.sh --check-only EXACT_MAIN_SHA` выполняет **ту же полную проверку предыдущей сборки**, что и рабочий rollback, но до любых операций с указателями останавливается. Печатает `STAGING_ROLLBACK_PREFLIGHT=PASS`, текущий и предыдущий SHA, число проверенных файлов.
- Неверный source SHA, отсутствие предыдущей версии, повреждённый manifest, несовпадение хешей и symlink приводят к отказу. Если GitHub коммит уже устарел, статус `SUPERSEDED`, никакого ложного PASS.
- `tests/test_r115_rollback_integrity.py` дополнен сценариями для безопасного `--check-only`; истинный rollback остаётся строго отдельным действием.
- `.github/workflows/marcosa-r116-rollback-readiness.yml` после успешной выкладки STAGING получает GitHub `workflow_run`, проверяет, что коммит ещё актуален, подключается к подтверждённому Contabo через pinned ED25519 host key только под `marcosa-deploy`, и пересылает **только read-only** bash. Не публикует артефакты, не меняет Nginx/production и не переключает `current`.
- Контрольный вывод и его количество файлов сохраняются в GitHub Actions summary. Если у VPS нет предыдущего проверенного релиза, job падает: это реальная проблема готовности к восстановлению, а не доказательство успешного отката.

## Границы

R116 подтверждает доступность **статического STAGING** восстановления, но не восстановление PostgreSQL, Supabase, пользовательских аккаунтов, приватных данных и не разрешает production cutover. Для корневого `https://marcosa.club/` требуется отдельное резервирование и подтверждение совместимости.

Общая цепочка: публикация → сравнение SHA на диске → HTTP 127.0.0.1 → публичный GitHub Pages HTTPS → сверка двух каналов по одному Git SHA → read-only проверка доступного предыдущего STAGING релиза.

## Ссылки

[Workflow R116](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r116-rollback-readiness.yml) · [MARCOSA R115](https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/130) · [Все выпуски](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions)
