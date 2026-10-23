# MARCOSA FUSION · Network OS R4

**Public source release — 23 October 2026. R4 architectural materials, procedural animation, efficient bloom and an on-device GPU/RAF test.**

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


## R3 — Cinematic Architecture & Device Graphics Lab

The standalone public preview now includes procedural digital-city architecture with metallic/glass facades, emissive windows, animated camera, atmospheric fog and a post-processing pass (film-style tonemapping, controlled glow, vignette and grain). This is real authored WebGL2 geometry, **not a generated screenshot and not full AAA photorealism**. No external textures, third-party 3D library or analytics requests.

- Three adaptive quality tiers: **ECO** (~5k triangles), **BALANCED/CINEMA** (~22k triangles with dynamic resolution caps).
- WebGL2 detection; an illustrated 2D city fallback when WebGL2 is unavailable.
- Automatically pause rendering while the catalogue modal is open, when the tab is hidden, or when the scene is off-screen.
- `prefers-reduced-motion` and data saver default to a static accessible scene; manual graphics quality control.
- Device Performance Lab: opt-in 12-second local FPS, p50/p95 frame time and frame-jank benchmark, downloadable JSON stored **only in the browser**.
- Chrome/Chromium smoke QA on desktop/mobile and reduced-motion layouts; this sandbox does not expose WebGL2 hardware, so full shader performance on the user device is **not yet verified**.

To test locally: `python3 -m http.server 8765 -d site`, open the preview, then expand **DEVICE PERFORMANCE LAB**. See [R3 performance guide](docs/CINEMATIC_R3_QUALITY.md).

Source: `site/immersive.js`, `site/immersive.css`, `tests/immersive.test.cjs`. The 16-product catalogue, rights checks and export flows are preserved from R2.

## R4 — Lumen District / material and post-processing engine

R4 builds directly on the source of the R3 scene. It adds architecture refinements, animated aerial lights, GGX-based physically inspired lighting with roughness, Fresnel, subtle procedural surface detail and height fog. Quarter-resolution separable bloom replaces expensive full-resolution blur. Adaptive pixel budgets prevent uncontrolled memory growth on high-DPI screens; ECO renders without bloom.

The **Device Performance Lab** reports observed RAF frame-delivery FPS/p50/p95/jank and, when supported by the browser, optional asynchronous GPU timer-query p50/p95. It also records canvas resolution, adaptive scale, triangles and draw calls. No telemetry is transmitted. The targets in the UI are **not actual measured results**.

- [R4 implementation details and real-device acceptance protocol](docs/CINEMATIC_R4_MATERIALS_GPU_QA.md)
- [R4 regression tests](tests/r4_graphics.test.cjs) and [offline Chromium WebGL2 initialization check](tools/r4_browser_smoke.py)
- Local preview: `python3 -m http.server 8765 -d site` and open `http://127.0.0.1:8765`.

**What is not established:** FPS on your physical laptop/phone, genuine production traffic or changes to the authenticated `marcosa.club`. GitHub Actions uses a hosted runner and, when Chrome is available, an offscreen software renderer; this does **not** substitute for real-device GPU benchmarking.


## R5 — Story Continuation Pilot / creator commercialization path

The next P0 master-plan milestone is implemented as real public-preview code: **three fictional branching interactive stories, two choices each and twelve explained outcomes**. Each ending offers an opt-in link to a specific existing source-backed project in the 16-product catalogue, or to its browser-only house-promotion draft. The new `stories.html` experience is accessible from the R4 home hero; RU/EN/中文 and reduced-motion support are included.

**Creator / Brand Studio** produces a rights-gated `marcosa-branded-story-brief/v1` in JSON and a self-contained printable HTML pitch. It does not publish content or send network requests. Optional `marcosa-story-qa/v1` is a tab-local, opt-in manual test report, not audience analytics. The three stories are original **fictional demos**, not the still-unverified 43 real film sites.

- [Open the story pilot locally](site/stories.html)
- [R5 legal/technical rollout gates](docs/STORY_CONTINUATION_R5_RU.md)
- [R5 branching, safe proposal and privacy tests](tests/stories.test.cjs)
- [R5 browser interaction test](tools/r5_browser_smoke.py)

Full authenticated MARCOSA, Worlds, Contabo production and Supabase remain unchanged. The public GitHub build confirms source code and browser QA only; no verified registrations, traffic, revenue or paid deals are claimed.
