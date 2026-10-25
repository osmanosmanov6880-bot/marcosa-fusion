# MARCOSA R80 — production evidence gate

The local release checker is **not** proof of a deployed service. It rejects an empty or incomplete ten-part external release checklist, demands HTTPS evidence references, and returns a nonzero exit code. Evidence URLs are self-reported and require an independent human security/legal review. A syntactically complete JSON file alone cannot authorize a production launch. Real Supabase, HTTPS staging, private media, verified SSH, paid operations and real cohorts remain separate release blockers.

Run `node --test ops/test/release-evidence-gate.test.mjs`, then `node ops/release-evidence-gate.mjs evidence.json`. Never place credentials, SSH secrets or personal user data in the evidence file.
