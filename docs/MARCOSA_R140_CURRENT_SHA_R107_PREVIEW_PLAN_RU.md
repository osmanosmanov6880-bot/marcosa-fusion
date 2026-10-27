# MARCOSA R140 — устранение ложного CURRENT-SHA PASS в реальном R107

**Инцидент найден 27.10.2026, без какого-либо изменения production.**

После слияния R139 в `main=f0da2d0072f48bac6daaa66c63abf281ac67bfd1` автоматический [R107 run #40562382706](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40562382706) завершился успешным workflow, но его независимо скачанный артефакт `12761706512` содержал:
- `sourceSha=53c237b021a71ef1b4e785531c65b3f7a644e55b` (**СТАРЫЙ** релиз);
- `stagingAssetsVerified=63`, `rootReplacementAllowed=false`, исходный Nginx SHA и legacy index как ожидалось;
- **нет доказательства** sourceSha=current main `f0da2d0`.

Причина: старый R107 запускался на `push` после изменения установщика ПАРАЛЛЕЛЬНО SSH STAGING — успевал прочитать предыдущую активную версию, хотя его workflow становился зелёным. Статус такого R107 нельзя использовать как current-release разрешение.

## Исправление

- Удалён `push` trigger R107. Автоматическая проверка теперь запускается **только после** завершения настоящего `MARCOSA | Build, test and deploy STAGING` через `workflow_run: completed`.
- Источник должен быть именно `push` на `main` в доверенном репозитории, не PR/форк/manual false positive. У upstream должен быть `conclusion=success`, SHA совпадает с текущим checked-out main и с API GET `git/ref/heads/main`.
- Путь R107 проверяет реальный VPS через ограниченный SSH-ключ `marcosa-deploy`, без root, миграций, перезаписи Nginx или клиентских данных.
- Полученный JSON отчёт сверяется с текущим RELEASE_SHA **ПОСЛЕ** SSH, проверяются Nginx baseline, число файлов, отсутствие root replacement, legacy digest и повторно live `main` через GitHub API. Старый отчёт предыдущего SHA теперь не может дать current-main PASS.
- Отдельный явный операторский `workflow_dispatch` допустим только с `AUDIT-MARCOSA-CANARY-READONLY`; прочие события не принимаются.
- `pull_request` запускает **только offline** контрактные/негативные тесты, без SSH. Слой `canary-plan` при PR всегда SKIPPED.
- `R140_EXACT_MAIN_REAL_VPS_PREFLIGHT=PASS` выдаётся только после всех подтверждений. Но даже тогда `R140_PRODUCTION=NO_GO`, а основной домен **не модифицируется**.

## Как принимать R140

1. Дождаться merge и новой цепочки R48/Pages/STAGING/R114/R116/R136 на новом `main`.
2. Открыть `MARCOSA | R107 preflight additive Nginx canary plan on VPS (read-only)` — для `event=workflow_run` того же SHA убедиться, что **`offline-contract=success` И `canary-plan=success`**, а не только workflow overall green.
3. Скачать `marcosa-canary-r140-current-main-vps-plan-no-go`; убедиться, что `sourceSha` равен текущему полному `main`, `stagingAssetsVerified` включает все ресурсы и `rootReplacementAllowed=false`.
4. На основном origin R108 по-прежнему подтверждает `safeToEnableSameOriginProductionAutomatically=false` (локальные IndexedDB/localStorage + не проверенный legacy auth). **Никаких root apply**, пока браузерная изоляция и старые интеграции не будут проверены.

## Что не закрыто

Настоящий production Auth/PostgreSQL/Storage и персональные данные, полная legacy source, самостоятельный HTTPS staging hostname, двухпользовательская RLS, ручные R132/R117/2×R118/2×R121/R122/R127 и письменное одобрение владельца остаются NO_GO. Старый `marcosa.club` не заменялся и не должен заменяться статическим превью.
