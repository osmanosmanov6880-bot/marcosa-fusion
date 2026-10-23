# MARCOSA Network OS R4 — materials, animated architecture and real-device performance

**Status:** public preview source. Not the authenticated MARCOSA platform. No Supabase, payments, real audience telemetry or production deployment is introduced.

## What changed from R3

| Layer | R3 | R4 |
|---|---|---|
| Geometry | Procedural buildings, beacon, plaza, window grids | Adds detailed gallery trims, metallic inlays, concentric walkway etching, lamp posts, additional skyline ribs and independently animated sky beacons |
| Surface lighting | Roughness-dependent specular and Fresnel approximation | GGX microfacet distribution + Smith masking-shadowing, Schlick Fresnel, two-color lighting, ambient environment reflections and controlled noise-based micro-surface variations |
| Motion | Moving camera and pulsing light emission | Adds vertex-animated aerial beacons; maintains time-based emission and smoothed pointer tracking |
| Atmosphere | Distance fog and full-resolution stylized composite | Height-sensitive fog and filmic color grade, subtle cinema-only chromatic offset, restrained vignette/grain |
| Bloom | High-resolution multi-tap glow | Four-times-downsampled buffer in each dimension, extraction plus separable horizontal/vertical blur, then full-resolution composite |
| Responsiveness | Three quality levels with static fallback | Explicit render-pixel budget helper, capped DPR, adaptive auto-resolution, fallback and reduced-motion compliance |
| Benchmark | requestAnimationFrame FPS, p50/p95, slow-frame share | Adds optional `EXT_disjoint_timer_query_webgl2` GPU elapsed timing, internal render dimensions, adaptive scale and triangle/draw-call counts |

**Important:** “Physically inspired” GGX lighting does not mean ray tracing, path tracing, full material textures, global illumination or AAA-grade physical accuracy. The preview uses authored procedural materials without network textures.

## Graphics pipeline (WebGL2)

1. Build geometry once per LOD tier, seeded to be deterministic.
2. Vertex stage animates emissive aerial elements (no per-frame vertex-buffer upload).
3. Material pass renders solid geometry into an RGBA8 framebuffer with depth.
4. When ECO bloom is off, composite the scene directly. On BALANCED/CINEMA:
   - Extract bright surfaces into a quarter-width, quarter-height buffer.
   - Blur horizontally, then vertically with two small taps-plus-center stages.
   - Composite the blurred buffer onto the full-resolution image.
5. Filmic tone curve, restrained grade, vignette and grain. Cinema tier alone adds slight chromatic offset.

The pipeline uses **3 draw calls in ECO** (sky, geometry, composite) and **6 in other tiers** (plus 3 bloom operations). Those numbers are the coded pipeline design, not observed GPU captures.

## Verified R4 geometry counts (deterministic source, not FPS)

| Tier | Triangles | Mesh vertex-buffer bytes | Maximum rendered pixels |
|---|---:|---:|---:|
| ECO | 5,462 | 720,984 | 520,000 |
| BALANCED | 24,144 | 3,187,008 | 1,050,000 |
| CINEMA | 28,012 | 3,697,584 | 1,950,000 |

These values were calculated from the built JavaScript geometry on 23 October 2026. They measure geometric complexity and pixel limits, **not performance on a physical GPU**. R4 remains below the 40,000-triangle regression budget.

## On-device metrics: what the report proves

Open **DEVICE PERFORMANCE LAB / GPU + FRAME PROFILING**, choose a quality tier and run the 12-second test. The browser exports `marcosa-graphics-device-report.json`.

- `metrics.fps`: rate at which frames were *delivered* via requestAnimationFrame. It is affected by refresh rates and pacing.
- `metrics.p50ms/p95ms`: distribution of observed time between delivered frames; **not** a direct GPU render time.
- `metrics.jankRate`: fraction of delivered frame intervals above 34 ms (observed).
- `gpu_timing.available`: indicates whether any successful asynchronous WebGL2 timer queries returned; unavailable is a valid result.
- `gpu_timing.p50ms/p95ms`: GPU elapsed query results when available. Such timings are a stronger indicator of GPU workload, but still require interpretation alongside refresh rate, render resolution and thermal state.
- `canvas_resolution`, `adaptive_scale`, `geometry_triangles`, `draw_calls_per_frame`: context for comparing like-for-like measurements.

**Privacy:** reports remain in the browser and are downloaded locally. No hardware vendor IDs, private messages, account data, network beacons or identifiers are collected.

## Device test matrix — acceptance targets only

| Device | Test tier | Indicative target | Additional observations |
|---|---|---|---|
| Desktop with discrete GPU | AUTO and HIGH | Sustained FPS >=55, delivered-frame p95 <=23 ms | Compare GPU query results if supported; cold + warm runs |
| Typical laptop | AUTO/BALANCED | Sustained FPS >=40, p95 <=34 ms | Compare AC/battery, warm-up, fan/heat observation |
| Mid-range physical phone | ECO | FPS >=27 and usable UI; p95 <=45 ms | Portrait/landscape, scroll, modal, thermal throttling |
| Accessibility | Reduced Motion, Save Data | Static 2D fallback, usable controls, no forced animation | Keyboard focus, readable 200% zoom |
| Failure resilience | WebGL2 disabled / context lost | UI and catalogue remain accessible | Do not publish a blank canvas or loop crash |

These are **product release targets**, not achieved readings. For comparability: close other tabs, keep viewport and quality constant, warm up 2 minutes, run three 12-second sessions, and repeat after five minutes. Record device class, browser version and power mode separately if you choose; the JSON does not collect them. Run once with AUTO and once with HIGH or ECO. If automatic quality changes during the benchmark, distinguish that session from a fixed-tier result.

## CI QA vs real hardware QA

- GitHub Actions runs Node geometry/LOD/pixel-budget tests, Python build/secret audit, Chromium WebGL2 shader initialization and five software-rendered screenshots (desktop 1440×900, mobile 390×844, catalogue desktop/mobile, and mobile 2D). Chromium WebGL2 initialization passed in PR #3. Those are actual code renders, not AI-generated concept images.
- The headless browser test prints `PASS-WEBGL2` only if a WebGL2 context actually initialized and shaders compiled. It prints `PASS-2D-FALLBACK` if WebGL2 was unavailable. Neither is a real physical GPU FPS test.
- **Physical hardware has not been remotely controlled or measured in this session.** No measured FPS, power draw, hardware temperatures or frame captures from your PC/phone should be claimed until the browser lab is run there and its results checked.
- Production `marcosa.club`, Worlds, Messages, Supabase and monetization remain unchanged.

## Rollout gate

Merge R4 into the public demo after code and CI QA; open a working GitHub Pages preview only when the Pages setting is enabled. The graphics demo is not a replacement for the original MARCOSA social frontend. Any production integration needs device-test results, accessibility checks, a complete original-source review, a staging backup and a tested rollback.
