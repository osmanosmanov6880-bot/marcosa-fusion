# MARCOSA R175: signed offsite high-water and PostgreSQL17 restoration gates

Date: 19 November 2026. PR: https://github.com/osmanosmanov6880-bot/marcosa-fusion/pull/168

## Five implemented blocks

1. **Dual Ed25519 source-bound archive anchor.** ops/r175/dual-anchor.mjs checks two distinct externally pinned signer public keys; exact R174 sequence, repository commit, source bundle, archive SHA256, escrow hash, checkpoint hash, parent anchor and expiration. Cryptographically distinct keys do not prove two actual independent human approvers.

2. **Immutable offsite anchor record.** ops/r175/anchor-store.mjs writes content-addressed signed evidence with IfNoneMatch=*, SSE-KMS, COMPLIANCE Object Lock and an explicit pinned object version. It independently reads HEAD and full version-specific GET and verifies bytes, S3 SHA256, KMS, expiry and signatures; no unversioned latest-object lookup. CI uses injected synthetic S3 responses, not a real AWS account.

3. **PG17 durable one-use recovery lease.** tests/postgres/176_r175_recovery_nonce.sql and ops/r175/recovery-nonce.mjs implement isolated r175_ci tables, NOLOGIN NOBYPASSRLS SQL writer, FORCE RLS and append-only audit. SERIALIZABLE transaction checks the R174 current checkpoint, writes a unique nonce and matching audit in a single SQL CTE, requires exactly 1|1, and denies reuse. The writer gets only a read policy on R174 high-water, not permission to modify the original checkpoint.

4. **Fail-closed offsite recovery supervisor.** ops/r175/recovery-supervisor.mjs checks the R174 high-water, signed pinned R175 offsite anchor, checkpoint freshness and emergency circuit BEFORE consuming the PostgreSQL nonce. It re-reads the checkpoint immediately before source-independent R173 restore, and records an enumerated incident on any denial. Does not grant production permissions or silently retry.

5. **End-to-end real disposable PostgreSQL17 and separate source verifier.** ops/r175/ci-acceptance.mjs plus .github/workflows/marcosa-r175-readiness.yml run R173 and R174 PostgreSQL 17 native dump/restore with synthetic AWS, then independently test R175 signed anchors, one-use PG nonce and audit, native pg_dump -Fc/pg_restore to a new disposable database, RLS persistence and replay rejection. Second runner checks exact R163 source SHA and whitelisted nonsecret evidence, with no PG/AWS credentials. The R163 source registry now includes R175 and has a hard cap of 100 files.

## External and production NO_GO

No live AWS credentials, IAM policy changes, S3 replication, KMS access, GitHub OIDC token issuance, independently verified human identity, production RPO/RTO or real customer data. No merge to main, live deployment, customer Supabase or payment changes.

The result is code integrated in PR. A run on the exact latest commit must pass before claiming complete CI acceptance. productionAuthorized=false.
