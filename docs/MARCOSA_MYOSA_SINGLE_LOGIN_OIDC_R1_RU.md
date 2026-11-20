# MARCOSA → MYOSA: единый вход (OIDC) — контракт R1

Статус: **NO-GO для production**. Документ описывает требования к настоящему SSO; не утверждает, что публичный сервер MARCOSA уже их выполняет. Не отключать MYOSA email/password до приёмки.

## Цель
Аккаунт MARCOSA на https://marcosa.club — единственная точка обычной регистрации и входа в https://myosa.world/app/. MYOSA остаётся отдельным продуктом OSMAN X WORLD, сохраняет свои права, проекты, квоты и историю, а MARCOSA отвечает только за идентификацию пользователя.

## Обязательный протокол
OpenID Connect Authorization Code + PKCE S256. Клиент `myosa-web`, callback строго `https://myosa.world/v1/auth/marcosa/callback`. Server-to-server HTTPS обмен `code`; токены не передавать через адресную строку и не хранить в localStorage. На MARCOSA: `/.well-known/openid-configuration`, HTTPS authorization, token и JWKS endpoints, подписание ID Token ключом RS256 с ротацией `kid`. Стабильный уникальный `sub` даже после смены email.

## Security acceptance
- `state` и `nonce` случайные, для каждой попытки новые; `code` одноразовый и живёт максимум 60 секунд; его обмен привязан к `client_id`, точному `redirect_uri` и `code_verifier`.
- Browser consent и правильные SameSite/HttpOnly/Secure cookie, защита CSRF и login-CSRF, rate limits и отсутствие open redirect.
- MYOSA проверяет подпись ID Token по JWKS, а также `iss`, `aud`, `azp` при нескольких audience, `nonce`, `exp`, `iat`; не принимает токены напрямую от браузера вместо обмена кода.
- Нельзя полагаться на неподтверждённый email; связывать существующие MYOSA-аккаунты только после независимой авторизации в обоих аккаунтах. Ключ связи: (`issuer`, `sub`), обязательна уникальность в БД.
- Блокировка, удаление, выход, отзыв сессии, потеря MARCOSA, восстановление аккаунта и rollback должны работать без потери сделок MYOSA. Привилегии модератора MARCOSA не превращаются автоматически в админские права MYOSA.
- Проверить 2 браузера, одновременные запросы, попытку повторного использования кода, неправильный state/audience/issuer/JWKS, истёкший nonce, подмену пользователя и ошибки сети.
- Отдельно подтвердить production HTTPS, серверную базу аккаунтов MARCOSA и реальный процесс восстановления доступа. Локальная Node/SQLite лаборатория не годится как доказательство готового production SSO.

## План включения
1. Реализовать и протестировать ID Provider MARCOSA на отдельном staging.
2. Установить клиентский OIDC callback и безопасную привязку учётных записей MYOSA; перенести существующие аккаунты с сохранением Sales.
3. End-to-end QA и бета с приглашёнными пользователями, мониторинг и откат.
4. Только затем скрыть старую форму MYOSA и закрыть `/v1/auth/register` / `/v1/auth/login` на сервере. Запрет доступа не должен опираться только на скрытую кнопку.

Reference: MYOSA branch PR #21, `src/marcosa-oidc.ts`; OIDC-проверки уже существуют как изолированные функции, не production flow.
