# MARCOSA R76 — строгий автономный контракт платёжных событий

**РЕЖИМ:** Node 22 + настоящая локальная SQLite только для полностью синтетических событий. Никаких оплат, Stripe-аккаунта MARCOSA, продаж рекламы, webhook endpoint, Checkout session API или реальных денег.

## Что фактически реализовано

`ops/payment-contract/stripe-sandbox-contract.mjs` — автономная исполняемая библиотека для моделирования безопасного приема событий оплаты:

- Проверяет подпись по **неизменённым сырым байтам** входного JSON: timestamp + точка + исходный body → HMAC-SHA256, совпадение в постоянное время, TTL ±300 секунд.
- Отказывается принимать `livemode:true`, реальные `cs_live_...` Checkout и неподдерживаемые типы. В тесте используется только синтетический `whsec_...` секрет.
- Считает `checkout.session.completed` событием оплаты только при `payment_status='paid'` и `mode='payment'`. При `unpaid` в журнале фиксируется отсутствие платежа; `checkout.session.async_payment_succeeded` с новым ID может позднее перевести операцию в `paid`. Нельзя зачислить предстоящий банковский перевод как уже оплаченный.
- Проверяет **сохранённую ДО получения webhook** пару `orderId + sessionId`, сумму в минимальных единицах валюты и точную валюту — значения из полезной нагрузки не могут подменять цену заказа.
- В одной SQLite-транзакции регистрирует идентификатор подписанного события и единственный тестовый receipt на заказ. Повторная доставка, новый event-id того же оплаченного Checkout, подмена события, неверная подпись/время, чужой заказ или цена не создают второй receipt.
- `sandboxCommercialStatus()` всегда возвращает `production:false`, `simulated:true`, `realPayments:null`, `verifiedImpressions:null`, `netRevenue:null`, `commercialLaunchAuthorized:false`. Значения 1–2 синтетических receipt **никогда** не публикуются как реальные доходы.

## Исполняемая приёмка

```bash
node --test ops/payment-contract/stripe-sandbox-contract.test.mjs
```

Действительно выполнено в локальном Node 22 перед отправкой в GitHub: **4/4 независимых теста успешны**. Они проверяют подлинную HMAC-формулу, повреждённые сырые байты, чужую секретную фразу, просроченный/будущий timestamp, настоящие SQLite-транзакции, равенство суммы/валюты, обработку неоплаченного и последующего отложенного платежа, повторные события и сохранение NULL по боевой выручке. `MARCOSA | R76 offline signed payment event contract` повторяет проверку в изолированном GitHub Actions.

## Отделение от настоящей коммерции

Это **не готовый production Stripe webhook**. Не реализованы реальные Checkout-сессии, подтверждение владельца платёжного аккаунта, `refund.updated`, возвраты, chargebacks, налоговая/юридическая документация, merchant-of-record, live event API reconciliation, rate limiting веб-сервера, invoice и обработка событий из нескольких Stripe-аккаунтов. В частности, невозможно считать `paid` в автономном тестовом ledger реальной выручкой MARCOSA.

При переходе в одобренный STAGING используйте официальную библиотеку `stripe-node` с закреплённой версией и `webhooks.constructEvent()`, секрет **конкретного конечного webhook endpoint**, raw HTTP body без JSON-middleware до проверки подписи, отдельную очередь retry/idempotency по событию и объекту оплаты, транзакционную базу и reconciliation с Stripe API. `service_role` / live ключи не размещать в клиентском коде.

Официальные справочные источники: [Stripe — manage webhook endpoints](https://docs.stripe.com/events/manage-webhook-endpoints), [Stripe — Checkout payment status](https://docs.stripe.com/api/checkout/sessions/object), [Stripe — idempotent requests](https://docs.stripe.com/api/idempotent_requests).

**Нельзя подключать доступный Stripe-аккаунт сторонней торговой марки, создавать реальные цены, подписки и списания без прямого подтверждения правообладателя коммерческого аккаунта.** Коммерческий релиз остаётся закрыт Issue #55.
