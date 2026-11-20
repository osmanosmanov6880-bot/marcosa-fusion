# MARCOSA R195 / SECURITY

Режим: независимое согласование. Статус: NO-GO.
Source SHA: 8b44191b2b555c5c579d569338899bc2769d2588
Source bundle: 42d4bb17f001b95d5935776ec5678950747432670a5fd536550b9798bea9b487
Assessment SHA-256: 9fdafb30031dd576cae39d65c88c33a1dc2213a4812f30eecd796b56c671fc32
Local task ledger SHA-256: 7d70bd2596cc57fa551d279b46155782c8040f2e0a0ea7cb83592157c3e5ba5e

## Обязательные действия
- **TLS_ORIGIN** (P2, BLOCKED, локально BLOCKED_LOCAL, динамика DEGRADED): Сравнить сертификат, DNS и отпечаток с независимым доверенным источником. Нужна независимая приёмка.
- **AWS_EFFECTIVE_RIGHTS** (P1, BLOCKED, локально OPEN, динамика UNMODIFIED): Независимо проверить IAM, SCP, KMS, resource policies и фактические разрешения. Нужна независимая приёмка.

## Ограничение
Локальные отметки, GitHub fixtures и PASS_CLAIM не удостоверяют личность, IAM, TLS, DR или privacy.
Никакого production GO или автоматического одобрения.
