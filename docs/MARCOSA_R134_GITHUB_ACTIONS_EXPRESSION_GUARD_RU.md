# MARCOSA R134 — исправление ручного R133 exact-main proof

26 октября 2026 г. Статус: инфраструктурный security-патч, **production NO-GO**.

## Обнаруженная ошибка

В уже объединённом R133 два выражения GitHub Actions находились в неправильном синтаксисе:

- `concurrency.group` был `marcosa-r133-${ github.run_id }}`, а должен быть `marcosa-r133-${{ github.run_id }}`.
- `env.GH_TOKEN` был `${ github.token }}`, а должен быть `${{ github.token }}`.

GitHub не может корректно раскрыть эти две некорректные конструкции. Общее время жизни/очередь task определяется literal concurrency group, а запросы read-only GitHub REST API могут получить несуществующий токен. **Нет доказанного завершённого R133 live-job** для этого неправильного workflow. Успех R48/Pages/STAGING/R114/R116 не доказывает R133.

## Реализация R134

1. Оба выражения исправлены на валидные GitHub Actions `${{ ... }}`.
2. Сохранён `cancel-in-progress: false`, чтобы разные запуски доказательств не могли отменять друг друга.
3. Сохранены только `contents: read` и `actions: read` без SSH ключа, service role, Secrets для production, `push` и доступа к реальным пользовательским данным.
4. Настоящий `actual-main-automatic-proof` по-прежнему разрешён **только** через `workflow_dispatch` на `main`, после offline-contract. В PR выполняются исключительно тесты.
5. Добавлено семь регрессионных проверок exact expressions, отсутствия сломанных `${`, ручного `main` scope, read-only прав, отдельного GH token, порядка offline → real job и невозможности получить production GO.
6. Инженерный отчёт R133 по-прежнему проверяет **пять стадий** и всегда заканчивается `productionDecision='NO_GO'` даже при успешном подтверждении STAGING/Pages/rollback.

## Границы доказательства

- Это исправление GitHub-workflow и тестов, не новый пароль или хостинг. Никакие файлы `/opt/marcosa/current`, Nginx, DNS или `marcosa.club` не изменяются.
- После слияния R134 SHA снова сменится. Для финального R133 proof нужно заново получить успешные R48, Pages, STAGING, R114 и настоящий R116 на **новом точном SHA**, потом вручную запустить [R133](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-r133-automatic-proof.yml) на `main`.
- Дополнительные R132 manual legacy read-only, R117, два R118, два R121, R122/R127 и проверка live Auth/JWT/RLS/PostgreSQL/Storage по-прежнему обязательны. Синтетические R128–R131 тесты не подтверждают реальную пользовательскую базу.
- Без доступа к исходной базе действующей MARCOSA, проверенного restore и отдельного согласования владельца вывод только **NO-GO**.

Проверять релизный журнал: [issue #55](https://github.com/osmanosmanov6880-bot/marcosa-fusion/issues/55) и legacy contract: [issue #135](https://github.com/osmanosmanov6880-bot/marcosa-fusion/issues/135).
