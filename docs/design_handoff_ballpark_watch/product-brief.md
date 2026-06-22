# Baseball Live Stats & Streaming App — Design Brief

> Companion to the build plan, for use in **Claude Design**. The goal here is the *look, layout, and flow* of the screens — a visual reference. The working realtime UI gets built afterward by Claude Code, so keep visual choices implementable in standard web components (no exotic layouts that won't translate to React/Tailwind).

---

## The app in one line

A browser/PWA that lets one parent score a youth baseball game play-by-play while family watches a live video stream with a synchronized scorebug, stats, and optional AI commentary. Video is optional; it also works stats-only.

## Three surfaces, three mindsets

The app is really three different design problems. Don't design them with one uniform style — each has a different user, context, and priority:

1. **Scorer console** — a fast, glanceable data-entry cockpit operated one-handed at the field while watching the game.
2. **Viewer** — a calm, broadcast-style screen where the video and scorebug are the stars.
3. **Setup** — ordinary pre-game management (teams, rosters, schedule), with one interesting moment (the lineup scan).

Plus one reusable component that carries the visual identity: **the scorebug**.

---

## Visual direction: old-school baseball, flat

The aesthetic is **vintage athletic, rendered flat** — the world of screenprinted pennants, enamel ballpark signage, wood-type lettering, old scorecards, and hand-operated outfield scoreboards. This is the deliberate opposite of GameChanger's glossy, rounded, bright consumer-app look. Vintage athletic design is *already* flat, so there's no tension between "old-school" and "flat" — lean into both.

- **Color — heritage, ink on paper.** Warm aged-cream base (like an old program/scorecard), deep navy or charcoal "ink," and accents from the classic ballpark: barn red / maroon, scoreboard green, vintage mustard-gold. Muted, not digitally saturated. Starting palette (a direction, not a mandate): cream `#F4ECD8`, ink-navy `#1A2A4A`, barn red `#A6342E`, scoreboard green `#2C5234`, gold `#C9A14A`. Reserve strong color for meaning (live indicator, ball/strike/out) and never rely on color alone — pair with shape/label (colorblind-safe).
- **Type — the era lives here.** Slab serifs (Clarendon-style), collegiate/varsity block letters, condensed athletic numerals — lettering off an old jersey or a wooden sign. Use display type for identity moments (headers, scorebug, team names, scores) and a clean legible workhorse face for the dense data in the scorer console so it stays usable. Numerals are first-class — crisp block digits at a glance.
- **Flat principles.** Solid ink-color fills, hard edges, defined rules and grids (like the lines of a scorebook), crisp panels. **No gradients, glossy buttons, soft drop shadows, glassmorphism, or neon.** Motifs are flat one- or two-color badges: a stitched ball, crossed bats, a pennant, a home-plate shape, the diamond, a single star. A badge/crest logo lockup suits this well.
- **Texture, handled carefully.** Vintage tempts paper grain, halftone dots, and distress — but those fight "flat." Get the vintage feel from **palette, type, and form**, and keep textures essentially off (at most a whisper of flat paper tone). This stays genuinely flat and ages better than a grunge look.
- **Light and dark are both required, and the dark mode is a gift here:** light mode is cream-and-ink (daytime, the scorer in sunlight); dark mode becomes the **night-game scoreboard** — dark green or navy panels with cream numerals.
- **Accessibility:** large tap targets, high contrast, big readable type, legible from across a room (the viewer may be cast to a TV). The heritage palette must still hit real contrast ratios — cream-on-green and cream-on-navy are your friends.

Recommended starting point in Claude Design: nail the **palette + display type + the scorebug** first. The scorebug appears on both the viewer and the stats-only mode and sets the tone for everything else — and the hand-operated scoreboard motif (below) is the purest expression of "old-school *and* flat."

---

## Surface 1 — Scorer console (`/score`)

**User & context:** one operator, standing at a sunny field, often one-handed, glancing down between pitches. Frequently the parent of a player — they want to *watch the game*, not stare at a screen. This screen is the antidote to GameChanger's most common complaint: feeling like "a prisoner to the app."

**Priorities (in order):** glanceable current state → minimal taps per play → fast, forgiving correction → sunlight legibility → thumb-reachable controls.

**Must contain:**
- A persistent game-state header, always visible: score, inning + half, outs, count, baserunner diamond, who's batting / pitching.
- A primary action zone with the most frequent taps as the biggest buttons: ball / strike / foul / in-play.
- A result picker for balls in play (single, double, triple, HR, the out types) — likely a quick secondary sheet/panel.
- Baserunner advancement (the fiddly part — make it fast and visual).
- Prominent **undo / edit last play** (misclicks happen at speed).
- Lineup / substitution access.
- Video session controls: start/stop stream + the live **delay slider** (to sync the scorebug to the video by eye).

**Layout direction:** a "cockpit" — fixed state display up top, big action buttons in the lower, thumb-reachable half. Design phone-portrait first, but tablet-landscape is a strong secondary (more room, less menu-digging) — worth a variant.

**Key states to show:** mid-at-bat (count building), ball-in-play result entry, runners-on with advancement, between innings, plus a sunlight/high-contrast treatment.

---

## Surface 2 — Viewer (`/watch`)

**User & context:** grandparents and relatives on a phone, tablet, laptop, or cast to a TV. Lean-back, passive, possibly for two hours, possibly while doing other things. They want to feel like they're at the game.

**Priorities:** video + scorebug are the stars → calm and uncluttered → works portrait and landscape → readable from across the room → near-zero interaction needed ("it just plays").

**Must contain:**
- The video player as the hero (or, in no-video mode, a large animated scoreboard as the hero instead).
- The scorebug overlaid on the video.
- Audio commentary control (on/off, volume).
- Secondary, out-of-the-way stats: box score, a play-by-play feed, a "now batting" card, game status (live / final).

**Layout direction:** video-first hero with the scorebug overlaid; stats and play-by-play scroll below in portrait, or sit in a side panel in landscape/desktop. In **stats-only mode**, the scorebug graphic becomes a full scoreboard hero with the play-by-play beneath it. Style the box score like a **newspaper sports-page box score** and the play-by-play like a vintage ticker — both reinforce the old-school feel.

**Key states to show:** live with video + scorebug; live stats-only (no video); final; and a clean "starting soon / not live yet" state.

---

## Surface 3 — Setup (`/setup`)

**User & context:** at home or pre-game, on phone or laptop, not time-pressured. Conventional management.

**Must contain:** team list, roster (player with number / position / bats-throws), schedule + games list, a create-game flow with a **video-source picker** (none / phone / external camera / YouTube), and the lineup builder.

**The one screen worth real design attention:** the **lineup scan review** — operator photographs a lineup card, AI extracts it, and the result appears in an **editable table to confirm before saving** (it will occasionally misread handwriting, so the review/edit step is the design, not an afterthought). Make this fast and trustworthy: clear "this is what we read, fix anything, confirm." Lean into the artifact — the lineup itself can look like a real lineup card (ruled rows, slab lettering), rendered flat and clean.

---

## The scorebug (reusable component)

Treat this as a small graphics exercise, and make it the anchor of the whole aesthetic. The motif is the **hand-operated ballpark scoreboard** (Wrigley/Fenway): a flat dark green or navy panel, cream/white block numerals in a simple inning grid, slab/block team lettering, hard rules between cells. This is the purest expression of the direction — peak old-school *and* inherently flat. It must:
- Read at a glance and stay legible **overlaid on busy, variable footage** (a solid flat panel does this naturally — no scrim trickery needed).
- Show: both teams' abbreviations + scores, inning + half (up/down arrow), outs, count (balls–strikes), optionally a small baserunner diamond.
- Scale responsively from a small phone overlay up to a large TV-cast board, and **expand into the full hero scoreboard** in stats-only mode — the same scoreboard language, just larger, with the inning-by-inning line score.
- Use block/varsity numerals so digits are crisp at any size.

---

## Cross-cutting

- **PWA**, installable, responsive across phone / tablet / desktop, with the viewer comfortable when cast to a TV.
- **No-video mode** is a first-class design case, not a fallback afterthought — both the viewer and scorer must look intentional without any video.
- Keep components standard and implementable so the design translates cleanly to React/Tailwind in the build step.

## What to come away with

A visual spec covering: the small design system (color, type, spacing, light/dark), the scorebug in its overlay and hero forms, the scorer cockpit (with its key states + a sunlight treatment), the viewer (video, stats-only, and final states), and the lineup-scan review screen.
