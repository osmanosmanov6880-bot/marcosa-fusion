# R193 Audit Desk

This is an offline staging-readiness evidence collector, not a deployment tool.

- node --test ops/test/r193.acceptance.test.mjs
- R193_ALLOW_NETWORK=1 node ops/r193/operator-cli.mjs --help

The CLI requires explicit source hashes, the exact GitHub run, and numeric identities for three reviewers, and creates a mobile-first standalone HTML, a Markdown audit and JSON evidence. Supply ops/r193/evidence.example.json as the evidence file if no external facts exist. It will truthfully show missing evidence and NO-GO.

The GitHub Actions workflow uploads an artifact named marcosa-r193-offline-audit-desk with index.html, report.md, signed-packet.json, signature.base64url and public.der.base64. CI external responses are fixtures, NOT actual operational approvals.

No live deployment, payments, credentials or production permissions are created.
