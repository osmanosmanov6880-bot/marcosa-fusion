# MARCOSA R26 — Social First / Workable Feed

**Goal:** solve the visual/product problem visible in genuine R25 screenshots: Social Core is dominated by an enormous marketing hero, while the real feed, saved items, and note editor sit far below the fold. Upgrade the functioning static-social preview, without inventing accounts, posts or server state.

## Actual changes
- Replace 560px+ phone hero with a compact editorial first impression (minimum 405px at 390px, flowing naturally for content). Keep R25 original sourced WebP background, premium burgundy/indigo palette, typography and gold logo.
- Three working shortcuts directly below the hero: Feed #so-feed, `?view=saved#so-feed`, Private editor #so-draft. The saved-counter reflects the **actual** `localStorage` saved ID array, not fake metrics.
- Bring real feed search and filters forward, display source-backed project cards as two-column gallery on wide desktop, single column on phone, with responsive intermediate layout.
- Eliminate R21 fake CSS orbital artwork from Social card headers. Use actual byte-verified R25 cinema-derived WebPs (cinema, Signal, Creator, Atlas).
- Preserve the editor, private note reflection, bookmark toggle, all four existing source cards, six full cinema engines and seven world routes. No remote APIs, CDNs or analytics.
- Extend real Chrome QA to verify compact hero height, 2/1 grid layout, original images, search/filter/bookmark counts and all existing routes at 1440, 390 and 360 pixels.

**Boundaries:** still an honest *local-only public preview*. A true multi-user social network would need a separately reviewed authentication/backend, privacy rules, moderation and a persistent database; R26 does not claim those features.

## Acceptance criteria
1. Python/Node build + original R25 film regression remain green.
2. Visible and clickable shortcut labels, count 0→1→0 on local bookmark.
3. No clipped elements or horizontal page overflow at 360/390px.
4. 15 Chrome screenshots with improved feed access, no regression to white R23.
5. Merge only after PR checks pass; publish only from main and verify deployed SHA.
