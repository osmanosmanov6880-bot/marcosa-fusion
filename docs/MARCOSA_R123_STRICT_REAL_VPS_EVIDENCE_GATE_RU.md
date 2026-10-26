# MARCOSA R123 — реальное доказательство R118 обязательно перед запуском R119 на Contabo

## Проверенный дефект релизной цепочки

У GitHub Actions есть законная ситуация, когда workflow имеет итог `success`, однако один из jobs завершился с `skipped`. Ранее реальный R119 запуск на VPS проверял итог всего R118 и успешную R117-публикацию, но **не сверял, что конкретный серверный job R118 реально исполнился**. Поэтому зеленый `R119` после одного offline-job при пропуске `isolated-vps-lab` мог визуально ввести в заблуждение; такой результат **не является реальным испытанием Node.js на Contabo**.

R123 закрывает эту дыру без изменения production.

## Исправления

1. `ops/r123_upstream_live_gate.mjs` проверяет через доверенные GitHub REST API данные *именно указанного* upstream run R118: полное имя нужного workflow, `head_repository`, `head_branch=main`, полную SHA, `event=workflow_run`, статус `completed/success`.
2. Более того, он требует **отдельный job** `live-production-parity` со статусом `completed/success`, а также успешный `offline-contract`. Пропущенный, отменённый или упавший живой job блокирует VPS-запуск.
3. Проверяет присутствие единственного неистёкшего JSON artifact `marcosa-r118-production-boundary-no-go` этого run, скачивает его отдельно через `gh run download` и валидирует `R118` — `R117=PASS`, `realProductionRootReadOnlyParity=PASS`, точно тот же SHA, `productionDecision=NO_GO`, `productionChanged=false`.
4. Только после `R123_REAL_R118_NONROOT_VPS_UPSTREAM=PASS` возможен переход к одноразовому R119 Node/SQLite HTTP smoke на `127.0.0.1`. Успешный **VPS** `isolated-vps-lab` и отдельный редактированный JSON-артефакт подтверждают это отличие.
5. Даже ручной запуск `R119` требует явного корректного `verified_r118_run_id`; произвольный run, прошедший только unit-тесты, больше не подходит.
6. На Contabo через SSH теперь копируется только фиксированный список необходимых публичных исходных файлов (`server.mjs`, 2 модуля зависимостей, UI публичной лаборатории, SVG и R119 smoke). Папка с тестовыми фикстурами и случайными локальными данными не передаётся.
7. В workflow R117, R118 и R119 `cancel-in-progress: false`, чтобы повторный upstream event **не отменял уже выполняемый серверный job того же коммита**. Последующие однотипные запуски могут стоять в очереди и должны рассматриваться по собственным журналам.
8. Добавлены 14 независимых offline-тестов, включая SKIPPED live job при общем `success`, подменённый SHA, устаревшие/неполные отчёты, неверный репозиторий и запрет production-изменений.

## Условия приёмки

- `node --test tests/r123_upstream_live_gate.test.mjs` → ожидаются 14 PASS.
- В PR запускаются только **offline** проверки. Такой PR нельзя считать real VPS proof.
- После прохождения exact-head PR/R48/Chromium QA и при безопасном окне для смены SHA — объединить R123 в `main`.
- Повторить для нового `main` в установленном порядке: GitHub Pages и STAGING → R116 → R117 → фактический R118 `live-production-parity=PASS` → R119 `isolated-vps-lab=PASS` с JSON-доказательством.

Это не означает восстановление реальных пользовательских данных, не доказывает production Auth/RLS, PostgreSQL/Storage или соответствие новой оболочки пяти отсутствующим legacy-модулям. **Production `marcosa.club` — NO_GO и не изменяется**.

## Ссылки

- [R119 workflow](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r119-vps-social-smoke.yml)
- [R118 workflow](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r118-production-boundary.yml)
- [Действующий production gate #55](https://github.com/osmanosmanov6880-bot/marcosa-fusion/issues/55)
