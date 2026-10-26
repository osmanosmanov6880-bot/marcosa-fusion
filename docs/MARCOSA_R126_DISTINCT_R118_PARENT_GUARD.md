# MARCOSA R126: independent R118 parents

R122 must not count two R121 reruns from one R118 audit as independent proof. R123 now writes its sanitized verified R118 parent identity. R121 checks the exact upstream run ID against the workflow_run event and source SHA; it publishes only the verified parent ID with public SHA-256 inventory. R122 requires two distinct parent IDs as well as distinct R121 run, job and artifact IDs. A PASS is restricted to publicly served bytes, not authentication, database recovery or production readiness. Production remains NO_GO.

Operational order: verify main Pages/STAGING/R116; manually dispatch R117; manually dispatch R118 twice on the same main SHA; require both real VPS parity jobs and artifacts; obtain two independent R121 hashes; dispatch R122 with their distinct run IDs. Any main change invalidates these proofs. R122 itself does not independently re-query R118 metadata; it relies on the R123 attestation in each R121 run.
