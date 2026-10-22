# MARCOSA FUSION — source, CI/CD and safe staging

**Current status:** Initial GitHub Actions automation is committed. **No successful VPS SSH connection, staging upload or production release has been confirmed.** The complete MARCOSA R2 source has **not** been imported into this repository yet.

## First-time setup

1. **Change this repository visibility to Private** before importing the original MARCOSA source.
2. Prepare the `marcosa-deploy` user on the verified Contabo VPS, with **no sudo** and staging-only access.
3. Verify that repository secrets are set: `MARCOSA_STAGING_HOST`, `MARCOSA_STAGING_USER`, `MARCOSA_SSH_KEY`, `MARCOSA_SSH_KNOWN_HOSTS`.
4. In **Actions**, manually run **MARCOSA | Verify staging SSH (read-only)**. This only checks SSH and reports safe server paths.
5. Import all individual source files from the private R2 starter distribution (`site/`, `tests/`, `tools/`), not a lone ZIP.
6. Wait for **MARCOSA | Build, test and deploy STAGING** to pass its build/test stage.
7. Only once the host, source and staging marker are verified, set repository **Variable** `MARCOSA_STAGING_ENABLED=true`.

## Included automation

| Component | Purpose |
|---|---|
| [SSH preflight](.github/workflows/marcosa-ssh-preflight.yml) | Manual read-only SSH check; refused for public repositories and root accounts |
| [Staging build/deploy](.github/workflows/marcosa-staging.yml) | CI tests, static build, SHA-256 verification and atomic deployment under staging user's home |
| [Staging rollback](.github/workflows/marcosa-staging-rollback.yml) | Manual, confirmation-gated switch back to previous staging release |
| [Setup runbook](docs/CONTABO_STAGING_SETUP_RU.md) | Commands for Windows PowerShell, Linux, GitHub and troubleshooting |

## Safety commitments

- Deploys **only** to `$HOME/marcosa-staging` as `marcosa-deploy`. Never deploys to `/opt/marcosa/current`, OSGARD servers or Supabase production data.
- Does not bypass SSH host-key verification, run as root, collect server databases or modify Nginx.
- Production deployment requires independent server/DNS verification, backups, content-rights checks, Supabase/RLS tests, a tested rollback and explicit separate configuration.
- Standalone user products remain independent systems; this repository is for the MARCOSA hub and approved integration points.

**Do not place SSH private keys, credentials, backup archives, `.env` or database dumps in the Git repository.**
