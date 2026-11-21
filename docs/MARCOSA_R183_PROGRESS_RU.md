# MARCOSA R183 — контроль реального staging без автоматического допуска

20 ноября 2026 · PR #168 · ветка `feature/marcosa-r150-growth-economics`

## Пять инженерных блоков

1. **IAM default permissions boundary в двух AWS-аккаунтах.** `ops/r183/boundary-policy.mjs` использует только GET `iam get-policy` и `iam get-policy-version` через ограниченный CLI R181; проверяет конкретные Policy ARN, актуальную `DefaultVersionId`, `IsDefaultVersion` и точное содержимое разрешённого read-only policy из версии R178, а также совпадение с R182 role-readback. Нет доступа к модификации ролей. Пагинация, расширение действий или неверная версия блокируют проверку. Это **не** доказательство effective IAM: SCP, разрешения ресурсных политик и ключей KMS, реальная identity и AWS-провайдер требуют отдельной оценки.
2. **Независимая история PR review поверх контроля GitHub Environment.** `ops/r183/github-pr-review.mjs` читает `pulls/168`, `pulls/168/reviews`, `commits/{sha}` (GET-only). Требует двух финальных событий `APPROVED` от разных указанных User IDs **именно для HEAD**, валидной GitHub verification, неизменного base/source и отсутствия новых `CHANGES_REQUESTED`. Если у истории больше одной страницы, доступ запрещается до полной проверки. Настройки GitHub и личности реальных людей в CI не подтверждаются — внешние ответы там синтетические.
3. **Симуляция реального окна потери данных на PostgreSQL17** (`ops/r183/delta-recovery.mjs`). В настоящем одноразовом PG17 записывается маркер BASELINE, делается `pg_dump -Fc`, затем **после снимка** записывается POST_BACKUP. `pg_restore` в `marcosa_r183_delta` обязан восстановить BASELINE и **не включать** POST_BACKUP. Фиксируется одна намеренно недостающая синтетическая запись и elapsed restore ms; это иллюстрация **риска RPO**, но никак не production RPO/RTO и не результат испытания клиентских данных. Сохраняются NO-GO, RLS и закрытый quarantine.
4. **Контролируемый пилот только со статусом NO-GO.** `ops/r183/pilot-gate.mjs` проверяет источник R182 и его SHA, два разных evidence SHA (IAM default boundary и PR reviews), полномасштабную проверку delta-признаков, двойной readback native R182 и закрытый карантин. Единственный вердикт `NO_GO_REAL_PILOT_EVIDENCE_PENDING`. `ops/r183/pilot-ledger.mjs` и `tests/postgres/184_r183_independent_pilot_gate.sql` сохраняют одноразовый source-bound SERIALIZABLE PG17 журнал + независимый audit, FORCE RLS, запрет UPDATE/DELETE, доступ authenticated запрещён. SQL проверяет наличие обоих настоящих synthetic маркеров.
5. **Приёмка и ручной read-only инструмент.** `ops/test/r183.pilot.test.mjs` тестирует tampered boundary/version, устаревшие PR approvals, отозванные решения, потерянную BASELINE, включение POST_BACKUP в старый restore, source race, неправомерный GO и replay. `ops/r183/ci-acceptance.mjs` делает реальное `pg_dump/pg_restore` для delta и затем **второе восстановление** уже с R183 hold, RLS и audit. Второй GitHub runner без AWS/PG заново пересчитывает source bundle и доказательства. `ops/r183/manual-preflight.mjs` — ручной, явный opt-in для real read-only IAM+GitHub PR аудиторов; он не запускается в CI, не пишет в облако/БД и не выдаёт одобрение к публикации.

### Действительный read-only запуск вне CI

Из reviewed checkout точного коммита необходимы AWS CLI v2, две **разные** именованные read-only AWS profiles, GitHub token с правами чтения PR reviews/commits и переменные:
`R181_SOURCE_COMMIT`, `R181_BUNDLE_SHA256`, `R181_SOURCE_*`, `R181_OFFSITE_*`, `R183_GH_READ_TOKEN`, `R183_REVIEWER_IDS`. Токены нельзя включать в коммит, чат, артефакты или логи. Дополнительно установить `R183_ALLOW_READONLY=YES_NO_DEPLOY`, затем выполнить `node ops/r183/manual-preflight.mjs --read-only`. Скрипт не получает доступ к production write и не открывает карантин.

### Границы результата

CI использует **настоящий disposable PostgreSQL17** и **синтетические GitHub/AWS API ответы**. Код поддерживает ручные реальные запросы, но реальные GitHub Environment/PR reviews, действительные IAM default boundaries, независимость людей, полная проверка effective AWS и production RPO/RTO здесь не проводились. Нельзя трактовать успешные unit tests и SHA как провайдерскую аттестацию. `productionAuthorized=false`; нет методов публикации, миграции production, изменения `main` или выхода из карантина.

Техническая приёмка — только два SUCCESS job GitHub Actions R183 на одном полном commit SHA.
