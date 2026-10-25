# MARCOSA R117 — три независимых подтверждения выпуска (только PREVIEW)

## Что выдаёт R117

R117 создаёт машиночитаемый `marcosa-r117-release-certificate.json` только после анализа GitHub Actions. Состояние **PASS** возможно лишь при совпадении полного 40-символьного SHA текущей ветки `main` и одновременном успехе:

1. **GitHub Pages:** полный build, публикация и независимое HTTPS-считывание всех файлов с проверкой SHA-256 (`verify-public-bytes`).
2. **Contabo STAGING:** полноценная сборка и проверенная доставка файлов по закреплённому SSH-ключу (`deploy_ssh_filesystem`).
3. **R116 на реальном VPS:** workflow, запущенный событием успешного STAGING (именно `workflow_run`, а не зелёный PR/push), с **двумя** зелёными job: `offline-rehearsal` и `read-only-vps-proof`.

Алгоритм строго различает `PASS`, `PENDING`, `FAIL` и `SUPERSEDED`. Успешная публикация **без** последующего HTTPS readback, пропущенная VPS-проверка и успешные тесты только локального Bash не дают сертификат.

## Где смотреть доказательства

- Workflow: [R117 triple-proof PREVIEW release certificate](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r117-release-certificate.yml)
- Сырьевые журналы: [GitHub Pages](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-public-pages.yml), [STAGING](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-staging.yml), [R116](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r116-rollback-readiness.yml).
- Артефакт R117 имеет отдельные поля `evidence.publicPages`, `evidence.restrictedContaboStaging`, `evidence.verifiedVpsRollbackCandidate`, SHA и состояние на момент проверки.

Сертификат **не является цифровой подписью** и подтверждает только проверенный момент времени. Новый коммит требует нового сертификата. Проверка повторяется при завершении реального R116 `workflow_run`, при завершении публикации GitHub Pages или вручную через `workflow_dispatch` на `main`. Это учитывает любой порядок окончания Pages и VPS. Преждевременный `PENDING` не становится `PASS` до получения всех трёх подтверждений.

## Что остаётся строго запрещено

`productionAuthorized=false`, `productionCutoverVerified=false`, `publicStagingHttpsVerified=false`, `databaseBackupOrRestoreVerified=false`, `privateAuthOrAccountMigrationVerified=false`. Даже `PASS` не означает, что существующий `https://marcosa.club/` можно заменить статическим сайтом: его аккаунты, хранилище, интеграции, обратная совместимость, резервные копии и восстановление должны проверяться отдельно. R117 не открывает SSH и не меняет сервер, DNS, Nginx или базы данных.

## Тестовая матрица

`node --test tests/release_certificate_r117.test.mjs` проверяет отсутствие ложного PASS при чужом SHA, stale main, PR и обычном push без VPS, skipped/in-progress/failed read-only proof, пропуске HTTPS-check, пропуске SSH deployment и некорректных входных данных.
