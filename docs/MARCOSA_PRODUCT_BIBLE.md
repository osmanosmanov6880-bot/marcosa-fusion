# MARCOSA Product Bible

## Product Thesis

MARCOSA is a world-first social platform. It is not a feed-first clone of an
existing social network, chat app, or video network. A person, creator, brand,
or community owns a World: an expressive digital place where people, content,
live experiences, discussion, events, and commerce connect.

**MARCOSA should feel like a place, not an app.**

The product grammar is:

`Person -> World -> People -> Experiences -> Creation -> Commerce`

## The Core Model

| Entity | Meaning | First release responsibility |
| --- | --- | --- |
| Person | A verified identity with a Personal World | profile, follows, interests, safety settings |
| World | A collective or personal digital place | identity, rooms, members, events, objects |
| Object | A contextual piece of content | image, video, article, story, poll, audio, live, creative work |
| Lens | A declared user intention | Discover, Connect, Learn, Create, Live, Shop |
| Room | A conversation or live context inside a World | public, members, private, voice/live |
| Event | A scheduled shared experience | RSVP, hosts, room, reminders |

## Product Pillars

1. **Personal World**: profile becomes an editable digital environment, not a
   biography page.
2. **Worlds**: communities have their own identity, content, rooms, events,
   members, media, market, and rules.
3. **Lens**: people control what they intend to experience. Discovery is
   transparent and adaptive rather than a single opaque feed.
4. **Creative Studio**: creation happens inside MARCOSA, beginning with an
   intentional multi-format composer and expanding to editing workflows.
5. **MARCOSA AI**: intelligence is contextual in discovery, creation, World,
   search, messages, and business tools. It is never a decorative chatbot.
6. **Live Rooms**: voice, video, text, polls, reactions, guests, and shared
   objects become a reusable social space.
7. **Social Commerce**: discovery can progress to trust, conversation, and
   purchase without breaking the experience.

## MVP Scope

The initial public MVP implements a coherent vertical slice, not all of the
long-term platform at once:

- Authenticated identity and onboarding with interests.
- Discover with explicit Lens modes: For You, Following, Worlds, Live.
- Personal World with identity, atmosphere, creations, Worlds, collections,
  activity, and links.
- World Home with branded identity, membership, Rooms, discussion, events,
  media, members, and info.
- Content Objects for image, article, story, and poll; reactions, comments,
  collections, and reporting.
- Direct messages and World Rooms, including basic real-time text.
- Create Studio for post/story/article/poll creation and media upload.
- Search across people, Worlds, and Objects.
- Notifications, basic moderation, roles, privacy controls, and audit trails.

Voice/video, payments, advanced AI, full editing, marketplace settlement,
native apps, APIs, and mini apps are staged after the core social loop is
working with real users.

## Experience Principles

- World-first, not feed-first.
- Dark space, light information.
- Obsidian, graphite, midnight, smoked glass, and metal foundations.
- Champagne, cyan, violet, amber, and crimson are functional accents, not
  decoration.
- Luxury digital, not cyberpunk and not gaming UI.
- Desktop is spatial and context-rich. Mobile is immersive, vertical, and
  one-handed. Neither is a scaled version of the other.
- Motion communicates relationship and depth: transitions, morphs, restrained
  parallax, ambient light, and tactile micro-interactions.
- Accessibility, performance, and user control are first-class requirements.

## Design System Tokens

| Token | Role |
| --- | --- |
| `--ink-0` | Obsidian application background |
| `--ink-1` | Graphite surface |
| `--ink-2` | Smoked glass elevated surface |
| `--text-primary` | Warm white primary text |
| `--text-secondary` | Muted information text |
| `--signal-cyan` | Intelligence, navigation, selected states |
| `--signal-violet` | AI and creation assistance |
| `--signal-champagne` | Premium and commerce |
| `--signal-amber` | Attention and pending state |
| `--signal-crimson` | Critical safety state |

## Trust, Privacy, and Safety

- Private data and direct messages have stricter access controls than public
  World content.
- Every content object and social interaction must have owner, visibility,
  provenance, reporting, and moderation paths.
- World roles: owner, admin, moderator, host, creator, member, verified.
- Recommendation eligibility excludes unsafe, spam, bot-like, and unresolved
  policy-violating content.
- User controls include Lens preferences, feed explanations, data export,
  account recovery, audience controls, and notification categories.

## Architecture Direction

The first production architecture uses a modular backend, not premature
microservices. Supabase/Postgres remains the system of record for identity and
the core social graph. The VPS hosts MARCOSA application services, reverse
proxying, realtime helpers, and media processing as needed.

Bounded domains: Identity, Profiles, Social Graph, Worlds, Content, Messaging,
Events, Search, Notifications, Creator, Commerce, AI, and Trust & Safety.

Media is private object storage with signed delivery. Search and recommendation
are introduced behind stable API boundaries. Secrets remain server-side.

## Delivery Sequence

### Phase 0: Foundation

- Product Bible, design tokens, component library, interaction contract.
- 15 key screens and a connected motion prototype.
- Production project, Supabase schema, deployment pipeline, VPS baseline.

### Phase 1: Core MVP

- Auth and onboarding.
- Discover and Lens.
- Personal Worlds, Worlds, Objects, Messages, Create, Search.
- Moderation, notifications, observability, and private beta controls.

### Phase 2: Meaningful Live

- Live Rooms, richer events, voice/video, World health, creator analytics.

### Phase 3: Intelligence and Economy

- Contextual AI, creator subscriptions, digital goods, marketplace foundations,
  business Worlds, and paid events.

### Phase 4: Ecosystem

- Native applications, APIs, SDK, mini apps, advanced recommendation systems,
  multi-region delivery, and global localization.

## Prototype Navigation Contract

The first high-fidelity prototype must support this complete journey:

`Discover -> Lens -> World -> Object -> Immersive -> Personal World -> Messages -> Create -> World`

Each transition must preserve context and make the user feel they are moving
through one connected space rather than opening unrelated pages.

## Measures of Success

- Weekly meaningful connections.
- World retention and health.
- Creator retention and quality creation.
- Relationship density, not raw scrolling time.
- Safety response quality and appeal resolution.
- Discover-to-conversation and conversation-to-creation conversion.