# MARCOSA FUSION · Network OS R4

> **Current deployment boundary (25 Oct 2026):** GitHub `main` automatically builds, checks and delivers its static preview to `/home/marcosa-deploy/marcosa-staging/current` on VPS `169.58.48.38`, with SHA-256 verification and a staging rollback path. The public `marcosa.club` continues to serve a distinct root-owned legacy application at `/opt/marcosa/current`. No automatic production cutover is authorized. See [R99 runbook](docs/MARCOSA_R99_AUTOMATED_SSH_STAGING_RELEASE_RU.md).


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
- Staging SSH deployment is restricted to trusted `main`, a dedicated non-root account, pinned verified host key, explicit environment and on-server approval marker. **As of 25 Oct 2026, the SSH host key was independently verified; isolated non-root staging delivery passed for 62 assets on Contabo (R99, [run #40232174313](https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/40232174313)). The real production site remains untouched.** GitHub Pages publication is independent of SSH.
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
- Zero user accounts, tracking, payments, cloud storage or automatic publication. **The standalone R8 editor tab is not persistent storage:** download the JSON to keep your draft, or opt into the R9 on-device version archive.
- [Creator technical and rights documentation](docs/ORIGINAL_STORY_CREATOR_R8_RU.md), [creator Node regression tests](tests/creator.test.cjs) and [Chromium desktop/mobile acceptance](tools/r5_browser_smoke.py).

Only the standalone public preview is extended. Original authenticated MARCOSA, Contabo production, Stripe and Supabase are untouched.

## R9 — Local Project Vault, versioning and review handoff

The public Creator Engine now includes a **deliberate, device-local project archive** based on IndexedDB (not cloud storage, not a login or a publishing system). It supports:

- Up to **8 separate story projects**, up to **15 rolling immutable revisions** each. Saving is explicit; no autosave or network calls.
- Restore an older revision into the editor, compare the changed writing fields with the previous revision and save the result as the next revision. Old snapshots are not edited in place.
- Detect two-tab stale-write conflicts in one IndexedDB readwrite transaction; a conflicting save fails rather than erasing someone else's version.
- Prepare an independent-human-review **JSON handoff** only from the latest saved matching story when all four author checks are complete. The export is *not* an approval, publication or submission to any server. Legal and editorial verification stay false in the output.
- Delete a whole local project with explicit confirmation. Drafts are **not encrypted by this application**, and clearing browser site data deletes them. Download separate JSON backups using R8's editor.
- Browser interaction QA now exercises actual IndexedDB (desktop and mobile Chromium via localhost); tests also cover invalid data, tampered review flags and the 15-revision cap.

Documentation: [R9 architecture, privacy and review boundaries](docs/LOCAL_PROJECT_VAULT_R9_RU.md), [revision/security tests](tests/vault.test.cjs), and [browser workflow](tools/r9_cdp_smoke.cjs).

**Important:** This is still the *public static preview*, not the authenticated production MARCOSA. No real moderator queues, live published author stories, contracts, commerce or existing user accounts were introduced.


## R10 — Portable local project archive and server-readiness security model

R10 adds a **complete local vault backup** to Creator Engine:

- Export every saved project and retained revision in **one portable JSON** (v1 schema, up to 8 projects, 15 revisions per project).
- Import a vetted file (maximum 2 MiB) with a preview of new / duplicate / conflicting entries. Exact duplicates are skipped. Diverged histories are saved under fresh project IDs; **existing records are never overwritten**.
- Restores are atomic IndexedDB transactions. Insufficient archive capacity aborts the entire import. Files are unencrypted; authors should keep backups safe and not share manuscripts publicly.
- Browser smoke QA covers real Chrome desktop and mobile: export, delete, restore, idempotent reimport and conflict-safe independent copies. No network requests other than the local test server.
- A reviewed but **not executed** SQL design is included at [infra/supabase/r10_cloud_schema_review_only.sql](infra/supabase/r10_cloud_schema_review_only.sql). It describes authenticated, owner-isolated projects and immutable revisions, review submissions, and a separate private moderation decision table with RLS and least-privilege grants.
- **No Supabase project was connected (project list empty on 2026-10-24).** This schema was NOT applied; user accounts, moderator accounts, public publishing, actual revenue and production services were not changed. The schema contract test only does static preflight, never a live SQL/RLS verification.

See [full R10 boundaries and acceptance](docs/PORTABLE_ARCHIVE_AND_CLOUD_SECURITY_R10_RU.md), [archive security tests](tests/backup.test.cjs), [SQL preflight](tests/test_cloud_schema_contract.py) and [real Chromium recovery QA](tools/r9_cdp_smoke.cjs).


## R11 — Password-encrypted archive exports (browser-only)

The Creator Engine now offers an **opt-in encrypted whole-vault export** alongside the R10 plain JSON backup:

- AES-256-GCM authenticated encryption with a fresh random 16-byte salt and 12-byte nonce; 600,000 PBKDF2-HMAC-SHA-256 iterations derive the key from a user-supplied long passphrase.
- Export every saved project and revision as an encrypted JSON envelope. Decrypt and restore with the same passphrase. Invalid passwords, changed ciphertext and malformed envelopes fail closed **before** any project is written.
- Restore uses the same atomic R10 merge transaction: duplicate entries are ignored and conflicting history remains separate rather than being overwritten.
- Password fields are cleared after every completed or failed encrypt/decrypt; there is no password recovery, server key escrow, account sync, analytics or network upload.
- **Important:** only the downloaded encrypted file is protected. Browser IndexedDB and the still-available legacy R10 JSON export remain unencrypted. A guessable password can be attacked offline.
- RU/EN/Chinese authoring UI, keyboard-focusable inputs, mobile layout, live WebCrypto tests in desktop/mobile Chromium, Node encryption/tamper tests, and screenshots.

See [R11 encryption format and cautions](docs/ENCRYPTED_ARCHIVE_R11_RU.md) and [cryptographic tests](tests/crypto.test.cjs). The Supabase connector currently lists **zero available projects**; R10's RLS SQL remains an unexecuted design. Production MARCOSA, Contabo, Stripe, authentication and server moderation were not changed.


## R12 — Export a self-contained playable branching story

The author can now turn the two-choice / four-ending Creator Engine draft into **one entirely standalone HTML mini-game** which readers can open offline with file://. No hosting, account, payment, server, dependencies or download other than the single author-created file.

- The editor adds three visually distinct themes (starry night, crimson horizon, northern lights), a sandboxed, live HTML preview, and a rights/sponsorship/privacy acknowledgment gate before download.
- All story text is encoded as JSON Base64 payload (not HTML or script source). The standalone player displays every author field with textContent only, preserving all four unique endings. Navigate with buttons or keyboard (1/2, ArrowLeft, R).
- A Content Security Policy blocks network requests, foreign resources and untrusted scripts; the sole inline script is pinned to its exact SHA-256 hash, generated through WebCrypto. Nothing from IndexedDB, local backups, passwords or moderator decisions gets into the exported file.
- Generated HTML works from file:// without a web server, even though compiling the file in the Creator Engine requires the secure GitHub Pages/localhost WebCrypto environment.
- Automated Node contract/XSS/CSP tests, real desktop and mobile Chrome file:// tests of all four endings, back/restart, keyboard, offline behavior and screenshot evidence. The public build allowlist is now exactly **15 files**.

This is an author-owned **local file export**, not a verified MARCOSA publication or licensed distribution of third-party content. The independent security and review gates remain outside the static prototype.

Documentation: [R12 offline playable story architecture](docs/OFFLINE_PLAYABLE_STORY_R12_RU.md), [unit tests](tests/standalone.test.cjs), [real offline browser test](tools/r12_offline_cdp.cjs).


## R13 — Voluntary offline reader feedback and author playtest dashboard

MARCOSA's offline R12 game now has an **optional ending rating** (1–5 stars), visible only when a reader reaches one of its four possible endings. The player explicitly downloads a tiny JSON feedback file and decides independently whether to send it to the author. The game never sends feedback over the network.

- Feedback schema marcosa-playtest-feedback/v1 permits only four fields: the schema, the SHA-256 fingerprint of that specific story revision, its two-decision route (00/01/10/11), and an integer rating 1–5. No name, IP address, email, timestamp, persistent ID, or free text.
- The Creator's new **Offline Playtest** section accepts manually received JSON files (max 2 KiB each, 100 per batch / 300 per tab) and shows counts, overall average and per-ending averages.
- The fingerprint prevents mixing ratings from different story versions. One invalid or mismatched report rejects the entire upload batch; editing the story clears prior displayed results.
- Summary JSON can be downloaded explicitly. Nothing is persisted to the cloud, IndexedDB, localStorage or analytics.
- **These are unverified report files, not confirmed unique readers, demand or actual audience analytics.** Duplicate or fabricated files cannot be reliably detected without identities.
- Tests cover real browser file:// downloads for all four endings, local report import and mismatch protections in desktop/mobile Chrome, data validation, CSP and the 16-file static release.

See [R13 implementation, privacy limits, security and acceptance](docs/OFFLINE_PLAYTEST_FEEDBACK_R13_RU.md) and [automated regression tests](tests/playtest.test.cjs). No payment, Contabo deployment or Supabase account integration is implied.

## R14 — Resumable film-site audit, immutable on-device snapshots

The public film-network page now supports **explicit offline snapshots** of the review of up to 43 manually supplied, source-validated film domains:

- Save an immutable local review version; retain up to **12 snapshots** in a browser IndexedDB database. Reopen any snapshot after refreshing the page. No autosave or server communication.
- Reopen an R13 `marcosa-film-pilot-evidence/v1` JSON export directly into the review editor after strict validation (≤1 MiB). Unknown data, inconsistent self-check counts, forged independent verification, inflated shortlist or published status are rejected **without replacing current work**.
- Restore and delete actions are confirmed. Adding a 13th snapshot is rejected atomically, and an older snapshot can be deleted manually to make room.
- Multiline review notes now roundtrip through the validation layer, and the interface remains RU / EN / 中文, keyboard-accessible and responsive.
- **Unencrypted local data:** browser site-data clearing can erase snapshots. Save a separate JSON file through R13's export button. None of this verifies site ownership, film rights or that 43 live domains exist.
- Browser tests using desktop/mobile real Chrome exercise import, audit, IndexedDB save, reload, restoration, malformed-file refusal, 12-version limit and cleanup.

[Russian R14 overview](docs/FILM_NETWORK_CONTINUITY_R14_RU.md) · [R14 regression tests](tests/film_continuity.test.cjs) · [R14 live browser acceptance](tools/r14_film_cdp.cjs).

## R15 — Source Atlas and direct cinema integrations

The user had previously supplied genuine source ZIPs. **13 distinct product archives** and **20 connected GitHub repositories** are now cataloged separately, not conflated with the unverified 43 film-site domain slots.

- **[Source Atlas](site/source-hub.html)**: searchable, responsive source records: real GitHub links, ZIP provenance and filenames, and clear production/rights boundaries. Static offline data only; no tracking, active scans or server calls.
- **[ZIP provenance](inventory/verified_source_archives_r15.json)**: original source archives, SHA-256 checksums and file counts. **[Connected repository map](inventory/verified_github_repositories_r15.json)**: 20 actual GitHub repos, source type and distinct movie-source classification.
- Direct cinema source changes merged in [Internet v. Humanity](https://github.com/osmanosmanov6880-bot/internet-v-humanity/pull/1), [Protocol Zero](https://github.com/osmanosmanov6880-bot/protocol-zero/pull/1), and [Adverse Judge](https://github.com/osmanosmanov6880-bot/adverse-judge/pull/1). Their existing actual ending scenes offer voluntary access to MARCOSA without transferring story data.
- User-provided source ZIP integrations independently built for SIGNAL WORLDS (108/108 tests passing), OpsPilot Cinema (279/279), and IntentGraph Cosmic ONE (3/3 new targeted tests); full modified ZIPs available as conversation artifacts, **not** hosted on the public MARCOSA site.
- Real movie-domain ownership, deploy status, streaming views, advertising revenue, legal rights and payment events remain unverified. A source repository is never sufficient to claim a live film website.

See [R15 implementation and source reconciliation](docs/REAL_SOURCE_INTEGRATION_R15_RU.md) and [Source Atlas tests](tests/source_hub.test.cjs). GitHub Pages static build contains only 23 reviewed web files, not the user archives, SQL or SSH credentials.

## R16 — real playable cinema rather than source-only cards

The public GitHub Pages source atlas now links to [MARCOSA CINEMA PILOT](site/cinema-pilot.html), where an actual standalone user-owned THE INTERNET v. HUMANITY prologue is runnable. Source HTML is copied **byte-identically** from [upstream commit 4c492d3](https://github.com/osmanosmanov6880-bot/internet-v-humanity/tree/4c492d30656d16a908f0dbd851a703f815b2d34e) and is verified by its Git blob hash. The player is sandboxed without same-origin access, loads on click, supports restart/fullscreen and has no automatic offsite navigation. The existing 2 verdict endings and evidence branch are browser-tested on desktop and mobile. PROTOCOL ZERO and ADVERSE JUDGE remain source links until original cinema assets and real public routes are verified. This is a playable **preview**, not the full commercial movie, and not an authenticated MARCOSA or Contabo deployment.

[R16 source audit and QA](docs/REAL_PLAYABLE_CINEMA_R16_RU.md) · [provenance manifest](inventory/playable_cinema_r16.json) · [Node tests](tests/cinema_pilot.test.cjs) · [real Chrome acceptance](tools/r16_cinema_cdp.cjs).
