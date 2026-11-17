# MARCOSA social-first rollout (R142)

This document records the first social-product implementation slice. It does not claim authenticated publishing or production operation.

## Product boundary

MARCOSA is a standalone social network for people, original content, creator profiles and interest-based circles. OSMANX WORLD remains an independent ecosystem. Its characters, websites and presentations may be introduced as clearly labelled sponsored stories or campaigns, subject to user consent, ad review and local advertising rules. They do not become MARCOSA navigation or product categories.

## Five implementation blocks

1. **Social-first navigation.** The public social preview now leads with Feed, Circles and Authors. It removes direct links to Cinema and Creator Studio from this social navigation while preserving their pages and source history.
2. **Clear product promise.** The top screen frames MARCOSA around finding people and creating a circle, with actions to open the feed or discover circles.
3. **Preview honesty.** The page explicitly states that registration, publishing, follows and messaging are not connected. It does not imply that demo cards are real user posts.
4. **Interest-oriented discovery labels.** Search and filters describe interests and communities rather than a catalogue of products.
5. **Responsive social shell.** R142 adds small-screen navigation and layout treatments; this remains a visual preview, not server-backed social functionality.

## Acceptance checks for the next engineering slice

- Verify all existing social page links and deep links on desktop and mobile.
- Ensure the preserved cinema, creator and source pages remain reachable directly and are not deleted.
- Do not expose a create-post action as live until authenticated persistence and authorization checks exist.
- Before beta, implement profiles, follow edges, posts, circles, comments, block/report, moderation and account deletion flows against a reviewed server boundary.
- Treat every paid placement as a distinct campaign record with advertiser identity, explicit ad label, review state, budget, dates and measured delivery.
- OSMANX promotional material requires rights confirmation and an ad label; organic-looking promotional content must never be disguised as user content.
- Do not use account, audience, revenue or conversion data from a static preview as real analytics.

## Ad MVP

Start with manually reviewed fixed-price placements in contextually relevant circles. Show the advertiser, label the placement as “Реклама”, cap frequency, record actual impressions and clicks, and allow users to hide/report it. Introduce CPM after impression quality is measurable, CPC after invalid-click controls, and CPA only after conversion attribution, refunds and fraud handling are reliable.

No income, reach, creator payout, or return on ad spend is guaranteed by this design.
