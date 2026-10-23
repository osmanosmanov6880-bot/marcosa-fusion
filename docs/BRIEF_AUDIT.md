# MARCOSA Brief Audit

Source of truth: `A:\HADJAL\Рабочий стол\МАРКОСА.txt` (4,889 lines).

Status meanings: `DONE` = implemented and production-verified; `PARTIAL` = visible/prototyped but missing a required backend or workflow; `MISSING` = no implementation found.

| Brief area | Status | Evidence / gap |
|---|---|---|
| Personal World / Identity | PARTIAL | Profile dialog reads/edits server-backed identity, uploads avatars, hydrates graph counts, renders approved seals, exposes authenticated export/deletion and local recovery bundle controls; social graph visibility, profile discoverability, blocked and muted accounts are enforced by owner-scoped RLS. Account Center sessions and stronger recovery remain incomplete. |
| Worlds | PARTIAL | World home, server-backed public directory, create/join RPCs, member list, owner/moderator/member roles, and server-backed text/voice/video room create/update/list flows are live; broader governance remains incomplete. |
| Lens / Discover | PARTIAL | Discover combines local/server search, category filters, server-synced reactions, comments and realtime comment updates; intent-ranked algorithm and AI feed controls remain incomplete. |
| Creative Studio | PARTIAL | Post/story/live modes, media upload and local image/video/audio/GLTF preview, server-backed typed content lifecycle, story expiry metadata, bounded drafts and collections are live; full editing timelines and 3D viewer remain incomplete. |
| MARCOSA AI | PARTIAL | Discover now consumes the timeout-bounded `MarcosaAI.ask()` result with local fallback; no model key is embedded and a production model service remains to be configured. |
| Live Rooms | PARTIAL | Supabase Broadcast signaling now includes Presence participant tracking and WebRTC peer helper; multi-party orchestration and recording remain incomplete. |
| Messaging | PARTIAL | Direct conversations and World Chat use Supabase `conversations`/`direct_messages` and RLS-protected `rooms`/`messages` with realtime; E2EE now encrypts transport payloads with AES-GCM and supports local recovery bundles, while multi-device key exchange remains incomplete. |
| Stories / Events | PARTIAL | Events have RLS hydration/creation/RSVP/reminders; stories use server content lifecycle with bounded 24h default / 7d maximum expiry metadata; richer story composer and delivery remain incomplete. |
| Creator Hub / Analytics | PARTIAL | Hub loads authenticated objects, server-derived totals, 30-day series, four weekly cohorts, publish/unpublish/delete controls and explicit revenue-unavailable state; revenue remains disabled by policy. |
| Marketplace / Social Commerce | PARTIAL | `market_offers` and `market_requests` are applied with RLS; client methods support creator-offer catalog, request creation and authenticated request history; payment, checkout and billing remain intentionally disabled. |
| Business / Brand Worlds | PARTIAL | Brand World workspace, transparent sponsored-object drafts, disabled-payment guard and owner verification request/moderator decision UI are shipped; `brand_worlds` and `brand_objects` are verified with RLS. Advertising controls and business analytics remain incomplete. |
| Search | PARTIAL | Discover combines local results with Supabase profile, public-World and public-content search; people results use the authenticated follow path, and opted-out profiles are excluded by RLS/client filtering. Global graph ranking, events/live/products search and AI search service remain incomplete. |
| Trust & Safety | PARTIAL | Moderation queue hydrates server reports/audit, persists severity and SLA deadlines, exposes overdue-open query and resolves through moderator RLS APIs; notification delivery and broader operations remain incomplete. |
| Notifications | PARTIAL | Activity loads, marks read and subscribes to authenticated Supabase `notifications`; Realtime publication and verified Postgres triggers for follows, comments and reactions are live, while broader delivery policy and batching remain incomplete. |
| MVP named scope | PARTIAL | Identity, Discover, Worlds, Messaging, Create, Search, Events, server follow paths and basic moderation are represented, but several are local/prototype paths. |
| V1/V2/V3, Mini Apps, Developer Platform | PARTIAL | Public Mini Apps manifest/SDK plus API/schema/registry, runtime validation, permissions, review, identity, payment-disabled fields, ECDSA signatures, isolated iframe/CSP runtime and local Developer Console drafts are live; server key storage remains incomplete. |
| Backend architecture | PARTIAL | Supabase schema/RLS/Storage, nginx HTTPS and Realtime publication for five active tables are production-verified; service boundaries and migrations are not fully operationalized. |
| Production | DONE | `https://marcosa.club`, `/healthz`, and `/PRODUCTION_EVIDENCE.md` return successfully; HTTPS/security headers and deployed runtime hashes verified. |

## Immediate execution order

1. Finish authenticated account/identity flow and server-backed profile state.
2. Finish server-backed conversations and realtime UI wiring.
3. Finish World/event provisioning and server-backed RSVP verification.
4. Add Creator Hub/analytics and AI service boundary without fake claims.
5. Re-audit every section against runtime evidence before declaring completion.

Payments remain intentionally disabled.