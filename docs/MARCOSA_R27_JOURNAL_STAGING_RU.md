# MARCOSA R27 — Personal Journal + repair of STAGING release pipeline

## Delivery scope

### Work block A — Actual Social product utility
The existing R26 live `site/social.html` now contains a true **local, multi-entry personal journal**. The original one-note scratchpad, public source-backed cinema links and local bookmarks remain intact.

The additional journal permits:
- Create and edit up to **40 individual entries** (title max 90 chars, body max 2,000 chars)
- Classify as idea, story, project or research
- Search, filter and sort; pin important records
- Delete with immediate undo
- JSON export to an **unencrypted manual local backup**, versioned import, schema validation, duplicate-safe merge and capacity guard
- Resume private content via browser-local storage. No network account, payment, tracker or false published post
- Render all user text through DOM text nodes, never as HTML

### Work block B — Real QA
- Pure Node validation tests check malicious input, duplicate IDs, invalid files, storage limits and merge.
- Actual Chromium tests click real user controls, persist/edit/pin/search/delete/undo, and confirm HTML-injection strings render only as plain text.
- Real screenshots at 1440×900, 390×844, 360×740.
- Keyboard operation and reduced-motion handling, graceful failure on unavailable/corrupt browser storage.

### Work block C — STAGING repair
Previous staging job failed before any deployment because it ran Python build/tests **without generating** `film-protocol-zero.html` and `film-adverse-judge.html`. The R27 workflow checks out the same two immutable source revisions as public Pages, compiles these standalone cinematic snapshots, verifies their native engine tests, then runs the Python and Node regressions.

**Deployment limitation:** STAGING SSH still requires configured host, non-root deployment user, host fingerprint and private key, plus the separate approved remote staging environment. Green staging builds do **not** imply a successful SSH deploy.

## Acceptance gate
- No merge before source verification, Node, Python and three-size Chrome tests all succeed.
- No change to 6 existing source-based movie engines or the seven independent world routes.
- Public Pages release checked against merge SHA.
- Any remaining staging deployment blocker reported clearly.

## Public-preview boundary
The current app is **not** a true multi-user social platform. Browser-local data is stored on a single device and an exported JSON backup is not encrypted. Do not store credentials or confidential personal records. Authentication, moderation, storage and server publications require a separately secured backend design.
