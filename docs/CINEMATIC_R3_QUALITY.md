# MARCOSA Network OS R3 — Cinematic Environment and Real-device QA

**Scope:** public preview of the discovery layer. The original authenticated MARCOSA, Supabase, Messages, Worlds and production servers remain untouched.

## Actual implementation

| Part | Technique | Notes |
|---|---|---|
| Architecture | Deterministic procedural WebGL2 mesh: plazas, facade grids, reflective pavement, towers, emissive windows, beacon rings, bridges | ECO: ~5k triangles; BALANCED/CINEMA: ~22k; no external textures or libraries |
| Materials | Normal lighting, roughness-controlled specular, view-angle Fresnel, emissive glass and atmospheric distance fog | Physically inspired approximation, **not** full PBR/path tracing |
| Post-process | Off-screen render target, glow reconstruction, filmic color curve, subtle grain and vignette | Bloom/glow disabled in ECO |
| Animation | Slow camera movement with smoothed pointer drift and animated emissive lights | Rendering suspended when hidden, off-screen or catalogue open |
| Responsive | Fixed upper pixel caps per quality, mobile CSS architecture fallback | Reduced motion and data-saver default to static |
| Interaction | Keyboard-accessible controls, CSS hover surfaces, modal existing paths preserved | Graphics never block R2 catalogue functions |
| Diagnostics | Opt-in 12-second on-device requestAnimationFrame benchmark, p50/p95 timing and jank share | Local JSON download only; no network, cookies or hardware IDs |

## Graphics quality settings

- **AUTO:** chooses ECO / BALANCED / CINEMA from coarse viewport, CPU/memory hints and accessibility preferences; sustained underperformance reduces quality.
- **HIGH:** manually selects CINEMA, bounded by 1.8 million render pixels.
- **ECO:** 30 FPS limiter target, <=550k render pixels, reduced geometry and glow disabled.
- **OFF:** static CSS skyline with no WebGL rendering.

Users with `prefers-reduced-motion:reduce` or Save-Data active begin with the 2D fallback. WebGL2 context loss also falls back safely. The interface is usable without WebGL.

## Acceptance matrix — real device required

No real personal hardware was remotely controlled in this development session. On the user's **actual desktop, laptop, and phone**, test the public preview using the controls below.

| Test device | Suggested requirement | How to test |
|---|---|---|
| Desktop GPU | Sustained >=55 FPS; p95 frame time <=23ms in AUTO/CINEMA (indicative target, not certified) | Expand DEVICE PERFORMANCE LAB, run 12 seconds, download report |
| Mid-range laptop | Sustained >=40 FPS; p95 <=34ms in AUTO/BALANCED | Repeat after 5 minutes and compare |
| Mid-range phone | >=27 FPS in ECO or usable 2D fallback; p95 <=45ms | Test portrait/landscape, scroll, catalogue opening |
| Accessibility | No forced animation with reduced motion; readable layout and keyboard navigation | OS reduced motion + keyboard navigation |
| Stability | No blank page on lost WebGL context; no auth/CSP breakage | Simulated WebGL block and browser console inspection |
| Memory/thermals | No runaway memory, thermal throttling or major long-task spikes | Chrome Performance / Task Manager during 10-minute soak |

Those numbers are **targets**, not observed results. Frame rates depend on hardware, browsers, power settings, screen resolution and GPU drivers.

## Device test procedure

1. Open the public preview after GitHub Pages has been enabled (or locally run `python3 -m http.server 8765 -d site`).
2. Ensure the catalogue is closed; the rendering engine pauses behind dialogs.
3. Switch from AUTO to HIGH and ECO to compare.
4. Expand **DEVICE PERFORMANCE LAB** and press **RUN 12S TEST**.
5. After completion, press **DOWNLOAD DEVICE REPORT JSON**. The JSON is saved locally. Only share it voluntarily and review any timestamp/viewport fields first.
6. Repeat on physical phone after a warm-up; test Save Data and Reduced Motion.
7. If the device cannot sustain quality, choose ECO or OFF.

## Verification actually performed

- Deterministic geometry generator tested with Node.js in all three tiers; bounded vertex counts and no NaN values.
- Desktop 1440×900 and mobile 390×844 HTML/CSS rendered in sandbox Chromium; no horizontal overflow observed.
- Reduced-motion fallback displayed correctly; no external assets needed.
- The sandbox's Chromium environment **does not expose WebGL2**, so WebGL2 shader compilation, actual GPU rendering times, battery usage and phone thermals are **not yet verified**. Do not claim AAA-photorealism or a measured real-device FPS from these tests.
- Independent R2 catalogue / CSV / campaign tests run in GitHub CI and must continue to pass before merge.

## Guardrails

No 3rd-party analytics, network beacons, wallet, payment APIs or private-key operations. The preview is a technical demonstration only. A production rollout requires an independent live-site and auth/RLS audit, backups, rollback and real-device verification.
