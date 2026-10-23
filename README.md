# MARCOSA FUSION · Network OS R2

**Public source release — 23 October 2026.**

An open, stateless preview of the MARCOSA discovery layer: 16 independent source-backed products, a catalogue, a 43-film-domain inventory template and browser-only promotional planning. **Not** a replacement for the authenticated MARCOSA platform, Supabase data, or an operational advertising exchange.

[Actions — verified build & tests](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/workflows/marcosa-staging.yml) · [Original integration HTML reference](reference/integrated-index-r2.html) · [Product strategy](docs/MASTER_STRATEGY_RU.md)

## Run the public preview

No dependencies or API keys are needed:

```bash
python3 -m http.server 8765 -d site
```

Open **http://127.0.0.1:8765/**. Click “Открыть Network OS”.

The preview supports RU/EN/中文, searchable product cards, category filters, A/B ad-text drafts exported as JSON, offline film-domain CSV import and HTML/JSON draft generation. It performs no user tracking, payment collection, advertising publication or domain-ownership verification.

## Public source contents

| Location | Content |
|---|---|
| `site/index.html` | Working standalone Network OS preview; **not** the original social app |
| `site/network.js` / `site/network.css` | Public app logic and responsive premium styling |
| `reference/integrated-index-r2.html` | Source-derived HTML from the original MARCOSA integration (requires original external frontend modules) |
| `inventory/film-sites.csv` | 43 unverified film slots; no invented domains |
| `docs/` | Strategy, product bible, audits, SSH setup |
| `tests/` | Python release and Node.js catalogue/CSV/XSS tests |
| `tools/build_webroot.py` | Deterministic, allowlisted static preview builder |
| `.github/workflows/` | Public CI; staging SSH workflows remain restricted |
| `scripts/` | Staging-only activation/rollback, not production deployment |

## CI result

The build at [Actions run #39877019560](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/39877019560) completed successfully: **5 Python tests**, **6 Node tests**, JS syntax check, reproducible static build, SHA-256 manifest and downloadable build artifact.

### Deployment policy

- This repository is **Public** by user choice. Public source CI is enabled.
- Staging SSH deployment is **disabled** while the repository remains public, even if secrets are present, to prevent risky unattended releases.
- No production files, Supabase schemas, authentication flows, messages, Worlds, DNS or OSGARD VPS were modified.
- Production and any full original-source import require separate secret checks, permission/RLS assessment, live-file comparison, private backups and a tested rollback.
- Do not commit private SSH keys, passwords, database dumps, `.env`, personal handwritten materials, access tokens or customers' data.

**Scope honesty:** This public repository currently contains the isolated R2 Network OS preview and source references, not all 118 files of the original R2 starter. The full offline starter ZIP from the earlier conversation is a separate artifact; uploading it without redacting sensitive material is not recommended.

[План развития MARCOSA](docs/MASTER_STRATEGY_RU.md) · [Пошаговое подключение Contabo](docs/CONTABO_STAGING_SETUP_RU.md)
