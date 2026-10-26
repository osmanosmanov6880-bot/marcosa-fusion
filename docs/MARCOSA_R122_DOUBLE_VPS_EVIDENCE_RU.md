# MARCOSA R122 — двойная независимая проверка публичных файлов на реальном VPS

Дата подготовки: 2026-10-26. Статус: CODE CANDIDATE, production **NO-GO**.

## Зачем это нужно

Зелёный статус GitHub Actions недостаточен. На основном коммите обнаружены успешные R121 workflows, у которых job `actual-vps-public-hashes` был `skipped`. Даже два таких workflow не доказывают ни одной реальной VPS-проверки.

R122 создаёт **отдельный ручной** механизм сравнения двух независимых настоящих R121 инвентаризаций. Никакого SSH, копирования файлов приложения, доступа к клиентским данным и изменения production в самом R122 нет. Запуск не должен автоматически размножаться при каждом завершении upstream workflow.

## Что обязательно для PASS

1. Workflow R122 запускается **только на `main`** с двумя явно заданными различными R121 workflow run ID.
2. Рабочая копия `main` имеет тот же полный SHA, что и входящий GitHub run; устаревший SHA блокируется.
3. В коде `main` уже установлены защиты R124: R116 отказ при superseded SHA + реальный R116 artifact, R117 проверка этого artifact, R121 проверка реального `live-production-parity` R118 перед SSH. До слияния R124 R122 откажет даже при двух R121 артефактах.
4. Оба R121 запуска принадлежат `osmanosmanov6880-bot/marcosa-fusion`, имеют событие `workflow_run`, ветку `main`, точный одинаковый current SHA и общий статус `completed/success`.
5. **Каждый** R121 имеет две реально завершившиеся задачи: `offline-contract=success` и `actual-vps-public-hashes=success`, разные job ID. `skipped`/`cancelled`/`queued`/`failure` недопустимы.
6. У каждого запуска есть отдельный неистёкший GitHub Actions artifact `marcosa-r121-legacy-public-hashes`, привязанный к правильному run ID. Артефакты должны иметь разные ID.
7. Из каждого связанного артефакта читается только ограниченный JSON `marcosa-r121-public-file-hashes.json`. Запрещены нечитаемые, oversized, дублированные, неподдерживаемые и похожие на приватные пути/имена. Проверяется число файлов, суммарный размер, SHA-256 canonical manifest, точный индекс, пять критических имён и флаги READ ONLY / NO_GO.
8. `PASS` возможен, только если два полных публичных списка (имя, размер и SHA-256 каждого файла) совпадают, а закреплённый R118 baseline index одинаков. Расхождение возвращает **DRIFT**, код завершения 3 и список имён публичных файлов без их содержимого.
9. При ошибке происхождения/отсутствии доказательств возвращается отказ, код завершения 2. Не выдавать `PASS` на основе количества зелёных workflow.
10. Итоговый JSON всегда содержит `productionDecision=NO_GO` и `productionCutoverAuthorized=false`.

## Ручной запуск после приёмки R124

Откройте Actions → `MARCOSA | R122 compare TWO actual independent VPS public SHA-256 snapshots (NO CUTOVER)` → Run workflow. Выберите ветку `main` и введите номера **двух реальных** R121 workflow runs с завершённым job `actual-vps-public-hashes=success` и неистёкшими SHA-256 артефактами. Нельзя указывать номера job ID вместо workflow run ID.

Исполняемый скрипт запуска сам проверит metadata GitHub API, jobs, artifact associations, content invariants и два полных списка SHA-256. При истинном PASS появится артефакт `marcosa-r122-two-real-vps-public-proofs`. Пустая/отсутствующая/заблокированная загрузка не является PASS.

## Что R122 НЕ доказывает

- **Не доказывает** историческую неизменность файлов между двумя снимками; наблюдается только совпадение на двух моментах проверки.
- **Не доказывает** самостоятельным образом точный upstream R118 event ID каждого R121. Эта часть доверия опирается на реально установленный fail-closed R124 в соответствующем `main` и R121 GitHub job; поле `r118UpstreamEventIdentityIndependentlyProven=false` намеренно сохраняет ограничение.
- **Не проверяет** приватные файлы, Supabase/PostgreSQL, Auth/JWT/RLS, пользовательские данные, медиа, cookie или старые API.
- **Не разрешает** заменять `/opt/marcosa/current`, перенастраивать `marcosa.club`, DNS/Nginx и переносить реальные аккаунты.
- **Не закрывает** юридическое, коммерческое или человеческое production-одобрение.

## Локальные тесты

`node --test tests/r122_dual_vps_inventory_gate.test.mjs tests/r122_workflow_contract.test.mjs`

Все тесты используют синтетические публичные манифесты и GitHub metadata fixtures. **Они не обращаются к Contabo.** После появления настоящих двух R121 proof необходимо независимо выполнить `workflow_dispatch` на главном SHA и проверить серверный artifact.

## Порядок интеграции

1. Закрыть PR #140 (R124) после exact-head CI, code review и предотвращения ложных PASS.
2. На новой версии `main` реально пройти STAGING → R116 artifact → R117 certificate → R118 live-production-parity → R121 actual-vps-public-hashes.
3. Получить второй независимый завершённый R121 workflow с отдельным VPS job и артефактом.
4. Запустить R122 вручную с двумя ID и проверить сохранённый отчет, SHA и `NO_GO`.
5. Отдельно закрывать legacy behavior, Supabase/Storage backup/restore, двухпользовательскую изоляцию, публичный HTTPS STAGING, DNS/cookie isolation и human go/no-go. Только тогда обсуждать production cutover.
