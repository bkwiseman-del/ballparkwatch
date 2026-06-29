# Bandbox — Marketing Page Design Brief

> For **Claude Design**. Goal: design the **public marketing / landing page** for Bandbox
> (the website at **bandbox.tv**). This is the *sell-the-product* page — not the app's
> working screens. It is self-contained; everything you need (brand, palette, type, message,
> pricing) is below.

---

## 1. What Bandbox is (one line)

**One parent broadcasts a youth baseball game from a phone; the whole family watches it in a
browser — no app — with a live vintage scorebug, full stats, and an AI announcer.** Video is
optional; it also works stats-only. The family **never pays to watch.**

## 2. The page's job

- **Primary goal:** get a parent / coach / team to **start free** (sign up and score/stream a
  game) — and plant the seed that one cheap **Team plan** (or a sponsor) unlocks the full
  broadcast for everyone.
- **Primary CTA (repeated):** **"Start free"** (and a secondary **"See how it works"**).
- **Primary audience:** the **baseball parent, coach, or team-booster** of a youth/amateur
  team. Warm, nostalgic, a little overwhelmed by clunky existing apps. Not technical.
- **Secondary audience (light teaser only):** people who **run a field or league** — one small
  section + link, never the focus.

## 3. What must land, in order (message hierarchy)

1. **The family never pays to watch — ever. No app, just a link.** (The emotional hook + the
   single biggest differentiator. Grandma taps a link and she's at the game.)
2. **It feels like a real broadcast** — live scorebug, stats, and an AI announcer calling the
   game — not a clunky stat app.
3. **Dead simple:** one phone films, everyone watches in a browser.
4. **Free is genuinely great** — scoring, the live scoreboard, full season stats, and live
   video are all free.
5. **When you want more, it's cheap and one team buys it for everyone** — or a local **sponsor
   covers it and the team makes money.**
6. **We protect the kids** — names down by default; private unless you choose otherwise.

## 4. Visual direction — "vintage athletic, rendered flat"

The aesthetic is the deliberate **opposite of the glossy, rounded, bright youth-sports app.**
Think screenprinted pennants, enamel ballpark signage, wood-type lettering, old scorecards,
and hand-operated outfield scoreboards. Vintage athletic is *already* flat — lean into both.

**Palette (heritage, ink on paper):**
- Cream `#F4ECD8` (aged-program base) · Ink-navy `#1A2A4A` · Barn red `#A6342E` ·
  Board green `#2C5234` · Gold `#C9A14A`. Muted, not digitally saturated. Reserve strong color
  for meaning/emphasis.

**Type:**
- **Alfa Slab One** — display (headlines, the scoreboard, big moments).
- **Saira Condensed** — athletic labels, numerals, eyebrows, buttons.
- **Archivo** — body/dense copy (clean, legible workhorse).

**Flat principles (hard rules):**
- **Hard corners — radius 0 everywhere.** **No gradients, glossy buttons, soft drop shadows,
  glassmorphism, or neon.** The *one* allowed shadow is a **hard 6px offset** (`shadow-hard`) —
  use it sparingly for a printed/stacked-card feel.
- Solid ink-color fills, hard edges, defined rules and grids (like a scorebook's lines), crisp
  panels. Flat one/two-color badges as motifs: a stitched ball, crossed bats, a pennant, a
  home-plate shape, the diamond, a single star.
- Texture mostly **off** — get the vintage feel from palette, type, and form (at most a whisper
  of flat paper tone). No grunge/distress.

**Light & dark, both required:** light = cream-and-ink (daytime program); **dark = the
night-game scoreboard** (dark green/navy panels, cream numerals) — dark is a gift here and
great for the hero. Default the page to **dark** for drama, or offer both.

**Hero device:** the **hand-operated ballpark scoreboard** (Wrigley/Fenway) is the purest
expression of the brand — a flat dark panel, cream block numerals, slab team lettering, hard
rules between cells. Build the hero around a Bandbox scorebug/scoreboard graphic.

**Brand assets (use the real ones):** logo PNGs in `docs/Logos/`; wordmark
`public/wordmark-on-dark.png` / `wordmark-on-light.png`; app/badge icon from
`public/.../App Logo.png` (a baseball + block **"B"**). Brand name renders **BANDBOX** /
**BANDBOX LIVE**.

## 5. Tone of voice

Warm, plainspoken, confident, a little nostalgic — *"take me out to the ballgame,"* not
*"AI-powered sports-tech platform."* Short, punchy lines. Talk to a parent in the bleachers,
not a CIO. Never corporate, never hypey. A dry baseball wit is welcome.

## 6. Page structure (section by section — purpose + copy seeds)

Copy is *seed/direction*, not final — adapt freely to the layout.

1. **Hero.** Big scoreboard graphic + one headline + the "Start free" CTA. Convey: a real
   broadcast, family-free. Seeds: *"Every game, broadcast like it matters."* / *"Grandma never
   misses a game — and never pays to watch."* / sub: *"One phone films. The whole family
   watches in a browser. Live scorebug, stats, and an announcer who calls every play."*

2. **The three steps.** *Score it. Stream it. Everyone watches.* Three flat panels with a
   simple badge each: (1) one parent scores/films from a phone, (2) a synced vintage scorebug +
   stats + AI commentary, (3) family taps a link — no app, no account, no paywall.

3. **Why it's different (the differentiator row).** A row/grid of flat badges:
   **No app to watch · The family never pays · Free stats & scorebook · A real AI announcer ·
   Works on any phone · A booster fundraiser** (sponsor-funded).

4. **"Watch live, free."** Show the viewer experience — the broadcast-style screen, scorebug
   over video, box score, play-by-play ticker. Emphasize "it just plays," and "cast it to the
   living-room TV." Seed: *"It feels like the big leagues — for a 9-year-old's Saturday game."*

5. **Pricing — simple and generous.** Lead with FREE. Four cards (hard-cornered, scoreboard
   style):
   - **Free** — *Score, stream, and watch. Full stats kept forever. Live video + a 24-hour
     replay. $0, always.*
   - **Single game — ~$8** — *Make one game a keepsake: HD video, the AI announcer, and the
     recording to keep.*
   - **Team — ~$149 / season** *(highlight as the hero card)* — *Every game, all season, in HD
     with commentary and a saved archive. One purchase covers the whole team — and the family
     still never pays. **Often covered by a sponsor.***
   - **Family — ~$29 / season** — *Personal extras for your player: follow-my-kid alerts,
     highlight keepsakes, a recruiting-ready record.*
   - A line under the cards: ***"Let a local sponsor put their name on the scoreboard and cover
     the whole season — your families pay nothing and your boosters come out ahead."***

6. **Built for the kids (trust/safety).** Short, reassuring. Seeds: *"We protect every kid on
   the field — including the other team's."* Names shown as first name + last initial by
   default; streams private unless you choose to share; you're always in control.

7. **The look (brand moment).** A full-bleed vintage scoreboard / scorecard visual that just
   sells the feeling — let the aesthetic breathe.

8. **Field & league teaser (secondary, small).** Seed: *"Run a field or a league? Light up
   every diamond — the crowd's phones are the cameras."* One sentence + a quiet **"For fields &
   leagues →"** link. Do **not** let B2B dominate the page.

9. **Final CTA + footer.** Repeat **"Start free."** Footer: logo/wordmark, links, the domain
   **bandbox.tv**.

## 7. Showing "better than the old way"

A tasteful contrast is powerful — but **frame it as "the usual way vs. Bandbox," not by naming
a competitor** (avoids a petty/legal tone). A small comparison block:

| | The usual youth-sports app | **Bandbox** |
|---|---|---|
| Family pays to watch | Yes (and needs the app) | **No — just a link** |
| Season stats | Costs extra | **Free** |
| Who pays | every family, or a pricey team pass | **one cheap team buy — or a sponsor** |
| Team can earn money | No | **Yes** |

Keep it confident and factual, not snarky.

## 8. What to avoid

- No glossy/rounded/gradient/drop-shadow "SaaS" look — that's the thing we're *against*.
- Don't lead with the field/league/facility business — that's a teaser, not the pitch.
- Don't over-claim AI or use cold tech language; keep it human and baseball-first.
- Don't bury the two hooks: **family never pays** and **no app to watch.**
- Don't name or bash competitors directly.

## 9. Deliverables

A responsive marketing page (mobile-first; comfortable on desktop) covering the sections above:
a scoreboard-driven **hero**, the **three steps**, the **differentiator row**, the **viewer
moment**, **pricing** (4 cards + sponsor line), a **trust/safety** band, a **brand visual**, a
small **fields/leagues teaser**, and a **final CTA + footer** — in the vintage-athletic-flat
system, light and dark, with the real Bandbox wordmark/badge.
