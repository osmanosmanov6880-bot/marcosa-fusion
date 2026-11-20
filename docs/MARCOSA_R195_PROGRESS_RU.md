# MARCOSA R195 — мобильный Audit Desk с проверяемой историей и пакетами для команды

20 ноября 2026, PR #168, feature/marcosa-r150-growth-economics.

## До начала
MARCOSA R194 принят: 3/3 GitHub Actions SUCCESS на SHA ea4289320790994823d1776cf8ba2714709c35c8, включая настоящую работу Chromium и независимую Ed25519-проверку. Production не изменён.

## Пять полноценных инженерных блоков
1. **Новый формат локального черновика v2** — ops/r195/draft-core.cjs: строгий source HEAD, assessment SHA, исходные восемь статусов, append/replay 200 событий, реальные SHA-256 digest через WebCrypto/Node, проверка полного транскрипта, действий и JSON. Импорт с неверным источником, ложным GO, подменённой историей или новыми полями отказывается. Это контроль целостности локальной записи, не доказательство идентичности человека.
2. **Рабочий мобильный интерфейс** — ops/r195/client.js, ops/r195/dashboard.mjs: выполнение, возврат, препятствия, история, поиск, фильтрация источника и ответственной роли, скачивание JSON непосредственно в память телефона/компьютера, импорт JSON через файл или вставку. Всё в одном index.html, без сервера, CDN, локального хранилища или отслеживания; CSP с SHA-256 одного inline JS.
3. **Наглядный анализ изменений** — панели восьми направлений риска и шести свидетельств: регрессии, заявленные улучшения, добавления, отзыв, изменение SHA-256 и claim. Разделяет source health, последствия и заявления; PASS_CLAIM никогда не превращается в production approval.
4. **Пакеты передачи шести ответственным ролям** — ops/r195/handoffs.mjs, ops/r195/operator-cli.mjs: для ENGINEERING, GOVERNANCE, DEVOPS, SECURITY, OPERATIONS, PRIVACY формируются отдельные Markdown и UTF-8 BOM CSV, source/assessment/ledger SHA, чёткие действия, статус NO-GO и проверяемый манифест. Офлайн CLI из R194 evidence.json атомарно создаёт index.html, report.md, handoffs/*.md, handoffs/*.csv и manifest.json.
5. **Независимая приёмка и фактический Chromium** — ops/r195/portable-package.mjs, ci-producer.mjs, ci-verify.mjs, ops/test/r195.acceptance.test.mjs, tools/browser/r195-audit-desk.mjs и workflow marcosa-r195-offline.yml. Реальная Ed25519 на одноразовом CI-ключе, второй runner сверяет git-tree, первоисточники, 6 SHA handoffs и рендер; Chromium на 360/390/768/1440 проверяет скачивание/импорт реального файла, replay, подмену, CSV, responsive и ноль исходящих HTTP запросов.

## Как открыть интерфейс для работы
Из R194 взять evidence.json, назвать его r194-evidence.json и выполнить в корне checkout:
node ops/r195/operator-cli.mjs --input r194-evidence.json --out r195-audit

Готовые файлы: r195-audit/index.html и report.md, папка r195-audit/handoffs/ с отдельными отчётами по ролям. Открывать index.html прямо на телефоне, без интернет-доступа. Для сохранения прогресса нажать «Скачать проверенный JSON», а затем через «Импортировать сохранённый файл» загрузить его обратно. Закрытие страницы без экспорта сбросит локальные действия.

Исходный R194 evidence.json должен содержать актуальные одноимённые SHA и ещё не просроченные R193 receipts. Поддельная история или чужой source SHA отклоняются. Все external provider данные CI остаются синтетическими, а ключ CI — эпизодическим. Ни одно действие не выдаёт юридический допуск или разрешение на запуск.

## Ограничения
Нет авторизации реального оператора, согласования людей, проверки фактической staging TLS/DR, AWS effective rights или legal/privacy. Поэтому всегда NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED, realPilotAuthorized=false, productionAuthorized=false. main и production не тронуты.
