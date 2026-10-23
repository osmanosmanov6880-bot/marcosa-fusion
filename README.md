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

R7 [GitHub Actions run #40014378002](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40014378002) passed tests and published the public demo on GitHub Pages. R8 adds new creator functionality and regression/browser QA; future results should be checked in Actions rather than assumed. The generated preview remains distinct from the authenticated MARCOSA app.

### Deployment policy

- This repository is **Public** by user choice. Public source CI is enabled.
- Staging SSH deployment is restricted to trusted `main`, a dedicated non-root account, pinned verified host key, explicit environment and on-server approval marker. **As of 23 Oct 2026, the external SSH host-key pin mismatches and VPS staging has not been deployed.** GitHub Pages publication is independent of SSH.
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


## R6 — Reliable publication (public preview + isolated Contabo staging)

R6 fixes the former deployment **configuration blockers**. The static GitHub Pages release no longer needs the unused `MARCOSA_PUBLIC_PAGES_ENABLED` variable; when a commit reaches trusted `main`, it runs the public build and attempts Pages publication. GitHub Pages still needs its one-time **Settings → Pages → Source: GitHub Actions** selection. SSH keys do not enable GitHub Pages.

The old `github.event.repository.private == true` and `MARCOSA_STAGING_ENABLED` gates caused all staging workflows to be **skipped** in this public repository, regardless of whether keys were correct. R6 replaces that broad guard with security-relevant checks: trusted main branch, `marcosa-staging` environment, explicitly pinned host key, validated private SSH key, dedicated non-root `marcosa-deploy`, server-side approval marker, SHA256 artifacts, atomic symlink staging deploy and post-release verification with attempted rollback.

Use `Actions → MARCOSA | SSH preflight / safe connection check` to distinguish the remaining external setup from workflow errors. It is read-only and executes on trusted main. Bootstrap the staging-only account through a trusted Contabo console only if the diagnostics report it unprepared.

- [R6 staging and Pages instructions (Russian)](docs/CONTABO_STAGING_SETUP_RU.md)
- [Deployment guardrail tests](tests/test_deploy_guardrails.py)
- [Read-only SSH diagnostics](scripts/diagnose-staging-ssh.sh)
- [Optional local VPS staging bootstrap](scripts/bootstrap-staging.sh)

**Explicit limit:** this deploys the public **stateless demonstration**, not the original authenticated `marcosa.club` application. It does not change production Nginx, Supabase, users, Worlds, or any other Contabo site. Staging files are not publicly available until a separately validated web-server route is configured.

## R7 — Deep-linkable fictional endings

Every R5 story ending can be copied as a public fragment link containing only its story ID and two choices. The receiving browser reconstructs the same ending and recommendation without an account or telemetry. The link strips query parameters and credentials. See [R7 design and privacy checks](docs/STORY_SHARING_R7_RU.md).

## R8 — Original Story Creator Engine

**New user-facing page:** [Open the creator editor](site/creator.html). Rather than only drafting a sponsorship brief, visitors can author a **real branching story** with 2 decisions, 2 individual second scenes and 4 original endings, then test every route interactively.

- 22 bounded fields, grouped into 8 independently editable narrative sections; sample fictional story included.
- Local import/export of a strict **marcosa-original-story/v1** JSON document. Import is capped at 128 KiB; unknown fields and fake publication status are rejected.
- Export requires fresh attestations of story rights and clear sponsorship disclosure where applicable. Neither represents independent approval.
- Interfaces in RU, EN and Chinese, accessible input/choice controls, responsive player and reduced-motion support.
- Zero user accounts, tracking, payments, cloud storage or automatic publication. **The browser tab is not persistent storage:** download the JSON to keep your draft.
- [Creator technical and rights documentation](docs/ORIGINAL_STORY_CREATOR_R8_RU.md), [creator Node regression tests](tests/creator.test.cjs) and [Chromium desktop/mobile acceptance](tools/r5_browser_smoke.py).

Only the standalone stateless public preview is extended. Original authenticated MARCOSA, Contabo production, Stripe and Supabase are untouched.
