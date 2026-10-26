# MARCOSA R127 — independent upstream verification inside R122

26 October 2026. **Production remains NO_GO.**

## Why
R126 proved that the two R121 public hash artifacts refer to different upstream
R118 run IDs attested earlier by R123. R122 itself did not independently fetch
R118 GitHub job and artifact metadata. R127 closes this gap.

## Evidence sequence
1. R122 checks two independent real R121 runs and downloads their bounded public hash artifacts.
2. R127 extracts their two distinct R118 parent IDs, requiring exact source SHA.
3. For each parent separately, the R122 job fetches GitHub's exact R118 run, jobs,
   artifacts and actual bounded NO_GO JSON bytes. IDs are strictly validated
   before use; no user input is evaluated as a shell command.
4. R127 reuses the R123 real-VPS validator to demand successful non-skipped
   offline and live parity jobs, a nonexpired same-run artifact, correct SHA,
   and read-only NO_GO payload. It additionally requires operator
   workflow_dispatch, never an automatic offline-only workflow chain.
5. The sanitized R127 receipt is required by the existing R122 comparison.
   A missing, different-SHA or mismatched-parent receipt blocks PASS.
6. R122 can now truthfully state that the two source R118 jobs and artifacts were
   independently checked at the R122 gate, not only attested by R121.

The result covers **public top-level files only**. It proves neither historical
immutability nor user Auth/RLS, PostgreSQL, private Storage, legacy behavior,
billing or backup+restore. A successful R127/R122 never permits DNS/Nginx changes
or replacement of marcosa.club.

Operator order is unchanged: current-SHA Pages + STAGING + actual R116; manual
R117; two separate manual R118 launches; two real downstream R121 VPS hashes;
then manual R122 with the exact two R121 run IDs. New source SHA invalidates all
older proofs. No job-level SKIP can count as success.
