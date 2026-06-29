> ⚠️ **SUPERSEDED (2026-06-29).** This doc has been folded into the unified
> [bandbox-plan.md](bandbox-plan.md) (post-rebrand to Bandbox, with the matchup-native model
> and the sub+sponsor monetization). Kept only as history — **do not edit; read the master
> plan instead.**

# Ballpark Watch — Product Strategy, Pricing & Platform Plan

> Companion to [baseball-app-build-plan.md](baseball-app-build-plan.md). That doc is the
> *technical* build plan (the spine). **This doc is the business + platform plan**:
> how we differ from GameChanger, how we **win existing GC users** (incl. data migration),
> how we price without punishing viewers, the video architecture that keeps latency off the
> upsell table, the team-ownership model, and the build sequencing to get there. Captured
> from the strategy session on 2026-06-27.
>
> Market research note (current as of June 2026): GameChanger's spring-2026 overhaul
> *tightened* its viewer paywall (families now get **5 free baseball/softball streams**,
> then pay) and rebranded itself a "live sports media platform." Team Pass is **$239/season
> (Plus)** / **$449/season (Premium)**; individuals $39.99–$99.99/yr; Family Plan $24.99/mo.
> ~$100M revenue (2024), ~9M users, ~1M teams. We do **not** beat them on scale — we beat
> them on *feel*: family never pays to watch, a real AI announcer, a vintage broadcast
> aesthetic, and a clean/private team model.

---

## 1. Positioning — the wedge

Be **the broadcast layer** — the thing that makes a family game *feel like televised
sport*. But be honest about what that means competitively (see GTM below): because our
synced scorebug, announcer, and stats are projections of **our** event log, broadcasting a
game means **scoring it in Ballpark Watch**. So we are **not** a passive add-on bolted onto
GameChanger — for the games we broadcast, we *replace* GC. We're a substitute that enters
through a side door, not a polite complement.

Four differentiators, in priority order:

1. **The family never pays to watch. Ever.** Direct counter to GC's new 5-game paywall.
   The *producer* (scorer/team) pays for cost-driving extras; viewers never see a wall.
2. **An AI announcer that's actually good.** GC's "live announcers" is brand-new and
   template-thin; this is our most defensible *differentiated* feature, not a me-too.
3. **Vintage-flat aesthetic** vs. GC's glossy sameness — matters for a "broadcast"
   product cast to a living-room TV.
4. **Clean, private team model** (see §4) — fixes GC's orphaned-team / leaked-roster mess.

### Go-to-market: selling to existing GC users
The market is entrenched in GameChanger (~9M users), so the positioning has to be precise:

- **Attack what GC *monetizes*, not what *locks teams in*.** GC markets broadcast as its
  headline and just *paywalled* it — but broadcast isn't the lock-in. The lock-in is
  (a) a kid's **accumulated stat history** and (b) the **league/opponent network** (leagues
  that *mandate* GC for official games). Broadcast is the veneer on that foundation. We take
  the monetized, emotionally-charged, now-weakened layer; we don't have to defeat the
  lock-in first.
- **Segment by whether the league frees them or traps them:**
  - **Segment A — league does *not* mandate GC** (rec, casual travel, younger kids without
    deep history). No real reason to keep GC once we're good enough → they can **fully
    switch**, and we *ask them to*. **This is the beachhead.**
  - **Segment B — league *mandates* GC.** Forced to keep GC for the official record, so they
    keep a foot in it — but we still win the family's **viewing/broadcast** experience.
    Coexistence here is a constraint imposed on them, not a polite offer; we own the
    emotional relationship even while GC keeps the compliance one.
- **Enter on the broadcast *occasion*.** Don't fight for the boring Tuesday game. Win the
  games families care about watching live (playoffs, far-away grandparents) — high emotion,
  low switching cost (one game, not a migration), buyer = the parent we're priced for.
- **Dissolve the lock-in with data migration (§6).** The #1 reason a team can't leave is
  sunk stat history. A one-click **import of their GameChanger stats** turns *"I'd lose my
  kid's three years of numbers"* into *"imported in two minutes."* That's what makes the
  switch actually close.

**The pitch, one line:** *We don't sit on top of GameChanger — we replace it for the one
thing it's worst at and charges most for: making a game the family wants to watch feel like
television, with the family never paying. Bring your stats with you; keep a foot in GC only
where a league forces it.*

**Where we knowingly lag** (be honest, don't chase parity): auto highlight reels, full
team-ops (scheduling/chat/payments), multi-sport, brand trust + Dick's distribution, and
raw network-effect scale. We *do* plan to match them on **stat depth** (§5) and
**discovery** (§7) — both are cheap for us and on-strategy. Pick the broadcast fight
narrow; that's what lets a small product win.

---

## 2. Pricing model

**Core principle:** *separate who benefits from who pays.* The person who most wants the
family included is the **parent/scorer**, not grandma. So put cost on the **producer
side**; viewing is always free, no paywall ever shown to a viewer. (This is the exact
inverse of GameChanger.)

### Free forever (the growth wedge)
- Live scoring + the live **stats scoreboard** + play-by-play + box score
- No-account share-link viewing
- **Small-audience phone video** via mesh P2P (~5 viewers) — near-zero cost to us
- Local **recording** of P2P games (see §3)

### Paid — producer/team buys, all viewers watch free
The paid features are exactly the **cost drivers**:
- **Scaled video** beyond the mesh ceiling (Realtime SFU — still sub-second; see §3)
- **AI voice commentary** (ElevenLabs per-minute)
- **AI recap / highlight clips** (compute)
- **External-camera broadcasts** (Cloudflare Stream / RTMP)
- **Long-term recording archive** beyond the free retention window

### How it's sold
- **Per-game broadcast pack** — low commitment, maps to actual cost.
- **Season Broadcast Pass** — GC's Team-Pass mechanic but *kinder*: booster/treasurer
  buys once, **every** family watches **everything** free, **no secondary viewer paywall
  ever** (GC's gotcha is that "fans" can still get walled — ours never are).

**Default buyer:** the scorer **or** the team/booster. (Decided.) Mitigate "charging the
unpaid-labor person" by defaulting the *team* as buyer and keeping the free tier fully
functional so nobody *needs* to pay to use the product.

### Exact prices — OPEN
Per-game $ and Season Pass $ are not set. Anchor points: GC Team Pass $239/$449/season;
our per-game cost floor is single-digit dollars (see §10). TBD.

---

## 3. Video architecture — three paths, three engines

**The rule that resolves the whole pricing tension: latency is *never* what money buys.**
Both *phone* paths stay sub-second, free→paid. The only path with a few-second delay is
the external-camera one, and that delay is a physical property of RTMP ingest, not a tier
we upsell.

| Capture | Engine | Latency | Viewers | Records? | Cost to us |
|---|---|---|---|---|---|
| Phone, small audience | **Mesh P2P** (built) | sub-second | ~5 | ✅ local→R2 | ~$0 (+ small TURN) |
| Phone, bigger audience | **Cloudflare Realtime SFU** | **sub-second** | dozens–hundreds | ✅ local→R2 | ~$0.045/viewer-hr; **1,000 GB/mo free** |
| **External camera** (RTMP) | **Cloudflare Stream / HLS** | ~few sec | 50+ (cap) | ✅ Stream-native→R2 | ~$0.06/viewer-hr |

**Why three engines, not one:**
- **Mesh P2P** is *free to us* (phone sends a copy per viewer; signaling on existing
  Supabase Realtime). Proven 2026-06-27: **cross-network on cellular, 2 hours, 4 viewers**
  held up. Ceiling is **scale** (phone uplink ≈ 5–8 viewers), not reliability.
- **Realtime SFU** is sub-second *and* scales (phone sends **one** copy up; Cloudflare
  fans out). Also **gentler on the phone** (one upstream vs. N) — so the upgrade is a
  *positive* pitch ("let everyone in, and your phone stops doing all the work"), never a
  latency downgrade. Slightly **cheaper** than HLS, with a big free tier.
- **Stream / HLS** earns its place for **external cameras only** — the SFU speaks WebRTC
  (WHIP) only, and real cameras (GoPro/DJI/Mevo/Larix) push **RTMP/SRT**, which only
  Stream accepts. Also best for truly massive crowds (edge-cached segments) and rock-solid
  TV/cast playback. Keep it *because external cameras are a wanted feature* (decided).

> ⚠️ Cloudflare **Stream's WebRTC (WHIP/WHEP) beta does NOT record** and can't output HLS
> from WHIP. That limitation is why we do **not** route the phone through Stream's WebRTC —
> we use our own P2P (free) and Realtime SFU (scales) for phones, and reserve Stream for
> RTMP cameras. Re-check Cloudflare's roadmap: if WHIP recording / WHIP→HLS ship, it
> simplifies things.

### The free→paid handoff (small audience → scale)
- **Never a hard wall.** Mesh degrades gradually; frame the gate as *headroom*:
  *"3 more family members are trying to watch — turn on the bigger broadcast to let
  everyone in,"* not *"pay or it breaks."*
- **Nobody is ever refused.** Overflow viewers fall back to the **free live scoreboard**
  (≈$0 to serve) until someone upgrades. **Video can cap; the game never disappears.**
- **Early-stage simplification:** Realtime's 1,000 GB/mo free tier ≈ **~1,100 free
  viewer-hours/month**. Until we exceed that we could run the **SFU for everyone**
  (sub-second, recorded, free to us) and keep mesh P2P as the **zero-COGS lever** for when
  we outgrow it. We are **not forced to pick the split today.**

### Recording & playback (do it — it's the *cheap* part)
- **Live is the expensive part; replays are cheap.** Store recordings on **Cloudflare R2**
  (~$0.04/game-month, **zero egress, ever**) and serve replays from there → a recap 500
  relatives rewatch costs ~nothing in bandwidth (unlike live).
- **How each path records:**
  - P2P / SFU → **`MediaRecorder` on the broadcaster phone** (it already holds the exact
    canvas+audio stream at `localRef.current`), **chunked with a timeslice** and uploaded
    incrementally to R2 (don't hold a 2-hr file in memory; iOS Safari supports it but is
    fussy). Independent of live delivery — the live experience is untouched.
  - External camera → **Stream's native recording**, then move the asset to R2.
- **Retention policy** caps storage liability: replays free for ~30–45 days (or the
  season); longer-term archive is part of the Season Pass / paid. (Window length OPEN.)

### Cost-overrun protection (so hundreds of viewers can never produce a loss)
- **50 concurrent video-viewer cap** per broadcast (decided), with **paid upgrades** for
  known big games (championships).
- **Scoreboard fallback** = the pressure valve (overflow → free realtime board).
- **Our own metering breaker:** track delivered minutes/GB per game; trip a breaker at the
  game's budget (Cloudflare has no hard auto-shutoff — we must enforce it).
- **Default 720p**; 1080p a premium toggle (egress scales with bitrate).
- **Credits under the hood:** sell viewer-hours; paid video stops when prepaid budget is
  exhausted, so we can never go underwater.

### TURN
Cross-network P2P needs a relay. We're on the free Metered Open Relay (won't hold up in
production) → move to a **paid TURN** (Cloudflare/Twilio/Metered). The `ice-servers` Edge
Function is already wired to drop it in — a config swap, not a rebuild.

---

## 4. Team ownership model — fix the orphaned-team mess

**The root problem:** a game needs two teams, but a self-serve app has one operator. GC
lets you mint a first-class Team record for the opponent → duplicate "Tigers," orphans
nobody owns, and other kids' rosters floating in a searchable directory. That's a
data-modeling mistake. Fix: stop treating "the opponent" and "a team" as the same object.

### Two distinct concepts
- **Managed Team** — a *claimed, owned* entity. Has an `owner_id` (+ staff), persists
  across seasons, holds real player profiles & invites, **can** opt into a public
  directory. **The only thing ever discoverable.**
- **Game-scoped opponent** — *not* a team. Just a label (name + optional ad-hoc jersey
  list) stored **on the game**, owned by the scorer, **private to that game**. Never in
  any directory, never findable, never orphaned (it isn't a global object at all).

So `games.home`/`games.away` each reference **either** a `managed_team_id` **or** an inline
opponent blob. Maps cleanly onto existing ownership-based RLS — opponent data inherits the
game's owner via the `owns_game()` helper. No new privacy surface.

### Promotion is explicit & consented (the orphan-killer)
- On game creation, **invite the opposing coach** by link. On Ballpark Watch → game links
  to *their* Managed Team. Not on it → stays a private label. **No orphan ever created.**
- After the fact, the real team can **claim** a game ("that was us") with the scorer's
  approval, associating the away-side stats to their team.

### Two wins this unlocks
- **Both-teams-score reconciliation.** When both parents score the same game, our
  event-sourced model shines: two independent event logs, one canonical game they can
  agree to merge into — or keep separate and let viewers pick a broadcast.
- **Privacy as a differentiator.** Minimize other kids' data: show opponent box scores as
  **jersey# + last name**, never expose a typed-in opponent roster to search. Dovetails
  with our "kids on camera, keep streams unlisted" stance. "We don't leak the other team's
  kids' data" is a real, marketable line.

**The one rule that prevents the whole mess:** *only claimed, owned teams with a real
manager are ever discoverable, and only if they opt in. Everything else is private to the
game that created it.*

---

## 5. Stat depth — per player & per team

Season/career stats are a major reason teams pay GC, and they're **cheap for us** because
everything derives from the event log (the spine). Unlike video, stats have ~no marginal
cost — so we can make them **free**, which is itself a wedge (GC gates "season stats"
behind Premium).

**Everything is a projection of `game_events`.** No separate stat store of record;
materialize/cache for performance (e.g. a `player_season_stats` rollup refreshed when a
game is finalized), but the event log stays the truth — any stat is recomputable by replay.

**Scope (tiered — ship essentials first, expand):**
- **Player batting:** AB, H, 1B/2B/3B/HR, RBI, BB, K, HBP, SB, R, AVG, OBP, SLG, OPS.
- **Player pitching:** IP, H, R, ER, BB, K, ERA, WHIP, pitch count.
- **Player fielding (later):** PO, A, E, FPCT — needs richer payload detail.
- **Team:** W-L record, runs for/against, team batting/pitching rollups, streaks, standings.
- **Spans:** per-game (box score) → per-season → **career** (across seasons, per player).
- **Advanced (later / premium polish):** splits, spray charts, situational.

**Privacy interaction (ties to §4):** only **Managed Team** players get season/career
profiles. **Game-scoped opponents accrue stats only inside that one game's box score** —
never a cross-game profile (they have no consented identity). A typed-in opponent never
builds a public stat line.

**Free vs paid:** basic + season + career stats are **free** (cheap to compute, and a
wedge vs GC). Advanced analytics / exports / spray charts can be paid polish — never the
core line.

**Accuracy tracks scoring completeness** — advanced fielding/situational needs payload
detail the scorer may not always enter. Degrade gracefully; show what the log supports.

---

## 6. GameChanger migration — the lock-in solvent

The #1 thing keeping teams on GC is **sunk stat history** (§1 GTM). The counter is
**data portability**: let a switching team **import their GameChanger stats** so they don't
start from zero. Competitors (Rizzler, TurboStats) already advertise GC import — proof the
move works and is expected.

**What's importable (user-exported — their own data):**
- **Season stat *totals* via CSV.** A GC **Staff** account can export season totals
  (batting / pitching / fielding) from the Stats tab. We map those columns to our stat
  fields.
- **Roster** — trivial (CSV, or our existing Claude-vision scan).

**What's *not* importable:** the **play-by-play event log** (GC doesn't export it), plus
**video, spray charts, highlight clips**. So we import **career totals as a baseline**, not
a reconstruction of past games.

**Architecture discipline (keep the spine clean):** imported numbers are stored as a
**separate, read-only "prior totals" record** per player/team, clearly labeled *"imported
from GameChanger,"* and **summed into career displays alongside** our event-sourced stats.
They **never enter `game_events`.** Our log stays the single source of truth for games
scored *in our app*; imports are a historical overlay. (Consistent with the event-sourced
principle and §5.)

**On-brand capture path:** extend the existing Claude-vision **lineup scanner** to
*"photograph your GameChanger stats page → OCR the totals → confirm in an editable table →
import"* — covers users who won't wrangle CSV, reuses infra we already have, same
human-confirm step (never auto-commit OCR).

**Keep it legally clean:** this works because it's the user exporting **their own data** and
handing it to us. **Never** scrape GC or automate against their service (no public API; a
ToS/legal risk). Frame it as data portability — which it is.

**Honest limits:** multi-season career = one CSV export per season/team in GC; import needs
a quick **map/confirm step** (which CSV row = which BPW player), same as the lineup scan.
One-time migration, **not** an ongoing sync (we can't keep pulling from GC).

---

## 7. Discovery & the public website

GC's filterable directory (state, season, sport) is real network-effect value and a
growth/SEO engine — but it collides head-on with our **privacy differentiator** and
youth-safety stance. The thread-the-needle answer: **discovery is real, but privacy-gated
and opt-in**, which is itself a selling point.

**What's discoverable:** only **Managed Teams that opt into a public profile** (the §4
rule — discovery just consumes it). **Game-scoped opponents never appear.**

**Filters (GC-parity):** state/region, season, sport + age/division, team/league name,
association.

**Public vs gated — the safety line:**
- **Public (safe):** team name, record, schedule, **scores/stats**, that a game exists /
  is live. Each public game = an indexable page (SEO/growth — the "media platform" surface).
- **Gated / opt-in:** full **rosters with minors' names** (minimized by default to jersey#
  + last name), and especially **video**. Streams stay **unlisted by default** (kids on
  camera); a team can flip a broadcast to public, but only by explicit choice. So a
  grandparent can *find the team and watch the scoreboard*; the *video* is public only if
  the team allows it.

**Two discovery modes, both first-class:**
- **Share-link** (existing no-account path) — always works for a specific game regardless
  of public/private. The private, friction-free default.
- **Directory / search** — opt-in public profiles for findability + SEO.

**Per-team privacy setting:** `Private` (share-link only) · `Discoverable (stats only)` ·
`Public (with video)`. Owner/admin controlled; per-player hide; **COPPA-minded** defaults
for minors (no kids' PII surfaced publicly by default). The stance: *"discoverable when
you want, private by default — and we never expose the other team's kids."*

---

## 8. Lineup exchange & multi-broadcast games

### Lineup exchange
Today the scorer builds their own lineup and types the opponent's ad-hoc. When a game
**links two Managed Teams** (via the §4 invite/claim handshake), each team's coach submits
**their own** official lineup and the app **exchanges** them — neither scorer re-types the
other side, and opponent at-bats accrue to the opponent's **real** player profiles.

**Consent governs data richness (the key rule):**
- **Consented exchange** between two Managed Teams = both opted in → **full lineups/names**
  are fine *within that game*.
- **Unilateral typed-in** game-scoped opponent (no consent) = **minimized** (jersey# +
  last name), never profiled. (Consistent with §4/§5.)

**Mechanics:** each team owns its own lineup of record; lineups lock at game start
(editable with a trail); in-game subs already handled by the `sub` event. If the opponent
isn't on BPW, fall back to today's minimal typed lineup.

### Both teams want to broadcast
Scoring and video are **orthogonal**, but the current P2P model is **single-broadcaster,
newest-wins** (`phoneVideo.ts`) — one feed per game channel today. Three options:

1. **Two separate games/broadcasts (near-term default).** Each team scores + broadcasts
   its own; this is exactly the **both-teams-score** case (§4) — two event logs, two video
   feeds. Viewers follow whichever team's share link they hold. **No new work** — it
   already falls out of the model.
2. **One canonical game, multi-angle (later premium).** One scorer of record (one log),
   multiple camera contributors → viewer switches **home/away angle**. The SFU supports
   multiple publishers naturally; the P2P single-broadcaster model would need extension. A
   natural **premium** feature.
3. **One broadcasts, other watches (simplest).** The game owner controls who may broadcast
   (`phoneVideo.ts` already has a scorer-side `kill`).

**Who controls?** The game owner (scorer) governs broadcast rights on their game. When two
Managed Teams link, the game is **co-context** but still one log of record per scorer;
both-teams-scoring reconciles per §4.

**Cost / convergence:** two live broadcasts = two streams (≈free on P2P; metered + per-
broadcast caps on SFU/HLS). The nice convergence: if both teams score+broadcast the same
game as separate games and later **merge** (§4), the merged canonical game can expose
**both feeds as multi-angle** — option 1 grows into option 2.

**Recommendation:** ship **option 1** (free, already implied by the model); offer
**multi-angle (option 2)** as a later premium feature once the SFU is in.

---

## 9. Offline-first scoring

Table stakes (dead-cell fields are normal; GC's native app scores offline). Our
event-sourced model is built for it — but it's a real build item, not free.
- **Local-first event queue** in IndexedDB; UI is optimistic and never blocks on network;
  sync to Supabase opportunistically on reconnect.
- **Monotonic per-game `seq`** (already in schema) gives offline events local order and
  reconciles on reconnect.
- **Conflicts are rare by design** — one scorer per game = append-and-flush, not
  multi-writer merge. (Both-teams-score = *separate* logs, a deliberate reconcile, §4.)
- Viewers still need connectivity for the live board; the **scorer** must keep working and
  the log must survive and sync intact. That's the requirement.

Prioritize early — it protects the integrity of the source of truth; a scorer who loses a
half-inning to a dropped connection never comes back.

---

## 10. Cost reference (confirmed June 2026)

| Service | Price | Notes |
|---|---|---|
| Cloudflare Stream — delivery | $1 / 1,000 min | bandwidth included; ≈$0.06/viewer-hr; ≈$0.12 per 2-hr game/viewer |
| Cloudflare Stream — storage | $5 / 1,000 min | ≈$0.60/game-month if kept in Stream |
| Cloudflare **Realtime SFU** | $0.05 / GB egress | **first 1,000 GB/mo free** ≈ ~1,100 viewer-hrs; ≈$0.045/viewer-hr |
| Cloudflare **R2** | $0.015 / GB-mo, **$0 egress** | replay storage; ≈$0.04/game-mo; free replay bandwidth |
| Mesh P2P | ~$0 | + paid TURN bandwidth for relayed (cross-network) peers only |
| ElevenLabs (AI announcer) | per-minute | template routine plays, LLM only highlights → ~couple $/game |

**Per-viewer-game rule of thumb:** ~$0.09 (SFU) to ~$0.12 (HLS) for a full 2-hr game.
Live is the only thing that scales with audience; replays (R2) are effectively free.

---

## 11. Platform — native scorer, web viewer

**Decision: split the platform by surface; don't pick one.** The three surfaces have
opposite needs:

- **Viewer → web, always.** The share-link / no-account / cast-to-TV model *is* the
  differentiator; requiring an install would kill it. Never native.
- **Setup → web is fine.** No native advantage worth the cost.
- **Scorer / broadcaster → native (at least eventually).** Every reliability weakness in
  the plan lives here, and the user (a committed parent) will install an app:
  - **Background camera capture** — fixes the #1 video risk (iOS tab suspension when
    backgrounded/locked, heat); a browser tab will never hold this reliably.
  - **Robust local recording** — removes the iOS Safari `MediaRecorder` fragility behind
    recording→R2 (§3).
  - **Real offline scoring** — how GC does dead-cell-field scoring; sturdier than PWA
    offline, especially on iOS (§9).
  - **Push notifications** ("your game is live") — solid on native, weak on iOS web.
  - **App Store presence + trust** — parents look for apps in the store; GC is there.

**How: Capacitor, not a rewrite.** Wrap the *existing* React/Vite app as a real native app
(App Store + Play) with native-plugin access to camera, background tasks, recording, and
push. We keep the whole codebase, keep the **viewer as pure web**, and add native plugins
*only* on the broadcaster (a native background-capture/streaming plugin is what solves the
tab-suspension problem). WebRTC (P2P + SFU) runs in the Capacitor webview.

**The App-Store-tax catch (affects §2 pricing):** in-app purchase costs **15–30%** — brutal
on a ~$7 broadcast pack whose margin video egress already thins. So **keep *purchasing* on
the web** (Stripe ~3%) and unlock entitlements in the app. US rules loosened in 2024–25
(external-payment link-outs are now permitted), which helps, but web-checkout-then-entitle
is the clean design. **Bake this into the billing from day one.**

**Trigger (when to build the native shell):** validate the core as a PWA first (cheap,
mostly built), then graduate the scorer to Capacitor-native **when the reliability tests
fail as a pure PWA** — specifically the full-length **background-capture** test and the
cross-network **paid-TURN** test (§3). If a browser-tab scorer can't hold a full game's
capture/offline reliably, that's the signal. This is "PWA-now, native-later" with a concrete
decision point, not a vague someday.

---

## 12. Build sequencing

Recommended order (each builds on the last; broadcast-first is the differentiated wedge,
team-ops follows). Stats/recording are somewhat parallel tracks:

1. **Offline-first scoring** — protect the spine. Local event queue + `seq` reconcile.
2. **Stat depth (season/career, per player & team)** — projections over the event log;
   own-team rollups are independent of the team model and high-value/cheap. (Cross-team
   career profiles firm up after step 6.)
3. **Recording → R2** — `MediaRecorder` on the broadcaster (P2P/SFU) with chunked upload;
   replay playback from R2; retention window. Makes P2P's free tier a killer feature.
4. **Paid TURN + P2P hardening** — swap the relay; verify cross-network at scale; this
   makes the free phone tier production-trustworthy.
5. **Realtime SFU path** — the sub-second *scale* tier; the free→paid handoff UX
   ("let everyone in"); 50-cap + metering breaker + scoreboard fallback.
6. **Team-ownership model** — Managed Team vs game-scoped opponent; opponent-invite
   handshake; claim/link; opponent-privacy (jersey# + last name). The **foundation** for
   migration, lineup exchange, discovery, and team-ops.
7. **GameChanger migration import** — CSV stat-totals + roster import → read-only "prior
   totals" overlay (optionally the vision stats-page OCR). The switching lubricant; high
   GTM leverage. Needs stats display (step 2) + roster to exist first.
8. **Lineup exchange** — official lineups swapped between linked Managed Teams; consent
   governs data richness (§8).
9. **Discovery & public website** — opt-in public Managed-Team profiles, filters
   (state/season/sport), indexable game pages; privacy-gated, video unlisted by default.
10. **External-camera (Stream/HLS) polish** — RTMP ingest, Stream-native recording → R2,
    delay-slider sync (already partly built for the YouTube path being replaced).
11. **Monetization plumbing** — per-game packs + Season Pass; credits/metering; billing.
12. **Team-ops growth (deferred)** — minimum to be the team's home: roster + schedule +
    invites (extends Managed Team). **Defer** chat/payments/registration unless pulled there.
13. **Multi-angle broadcast (later premium)** — multiple camera feeds on one canonical
    game; viewer switches home/away angle (§8).

**Platform note:** the above is one shared React codebase. The **viewer stays web**
throughout; the **scorer/broadcaster graduates to a Capacitor native shell (§11)** at the
reliability trigger (likely around steps 3–4, recording + capture hardening). **Billing is
always web-checkout** to dodge the App Store cut, regardless of surface.

---

## 13. Decisions vs. open questions

### Decided in this session
- **Platform: native scorer, web viewer.** Viewer/setup stay web (the share-link model is
  the moat); the scorer/broadcaster graduates to a **Capacitor** native shell (reuse the
  codebase) for background capture, recording, offline, push, and store trust. **Billing
  stays on web** to dodge the 15–30% App Store cut. Build at the reliability trigger (§11).
- **Positioning is *substitute*, not complement.** Our scorebug/announcer/stats are
  projections of *our* event log, so broadcasting a game = scoring it in BPW → for broadcast
  games we **replace** GC. Enter via the broadcast *occasion* + **Segment A** (leagues that
  don't mandate GC); attack what GC *monetizes* (broadcast), not its lock-in.
- **GameChanger migration** — offer a one-time import of a team's GC data (CSV stat totals +
  roster; optionally a vision OCR of the stats page) as a **read-only "prior totals"
  overlay**, never into the event log. The lock-in solvent. **User-exported data only —
  never scrape GC.**
- **YouTube is out** — field PA music = automated copyright strikes; a channel strike is
  existential, not a per-game annoyance. Use Cloudflare.
- **Latency is never the upsell.** Phone paths stay sub-second free→paid (P2P → SFU).
  HLS/Stream is the *external-camera* tier, not the "paid phone" tier.
- **Three engines:** P2P (free/small) · Realtime SFU (paid/scale) · Stream HLS (camera).
- **50 concurrent video cap** with paid upgrades for big games.
- **Record games** for playback; store on R2; retention window then paid archive.
- **Family never pays to watch**; producer/team pays; viewers always free.
- **Default buyer:** scorer or team/booster; Season Broadcast Pass + per-game packs.
- **Stat depth** (season/career, per player & team) is a planned feature, derived from the
  event log, and **free** (a wedge vs GC, which charges for season stats).
- **Discovery / public website** is planned but **privacy-gated & opt-in** — only public
  Managed Teams appear; video stays unlisted by default; game-scoped opponents never show.
- **Lineup exchange** between linked Managed Teams; **consent governs data richness**
  (exchanged = full names; typed-in opponent = minimized).
- **Both-teams-broadcast:** near-term = two separate broadcasts (already implied by the
  model); **multi-angle** is a later premium feature.
- **Grow into team-ops**, sequenced after broadcast; built on the Managed Team entity.
- **Build offline scoring.**
- **Keep external-camera support** as an option.

### Still open
- **Native trigger timing** — wrap the scorer in Capacitor *now* (de-risk capture early)
  or strictly *after* the PWA reliability tests fail? (§11)
- **Segment focus** — are our target local leagues mostly **Segment A** (switchable) or
  **B** (GC-mandated)? Shapes messaging: sell "switch" vs. "watch here." Ground it in your
  own kid's league first.
- **Migration scope** — CSV import first, or also ship the stats-page **OCR** import? How
  many past seasons to support; how the player-row → BPW-player mapping is confirmed.
- Exact $ for per-game packs and the Season Pass.
- The P2P↔SFU handoff UX (when a game starts on which engine; how a 6th viewer triggers
  the "let everyone in" upgrade without a jarring reconnect).
- **v1 stat list** — how far into advanced/fielding stats to go; which (if any) stats are
  paid (advanced/exports) vs. all-free.
- **Discovery default** — lean `Private`/share-link by default for youth safety, or
  `Discoverable (stats only)`? COPPA posture for minors' data.
- **Multi-angle model** — native multi-publisher on one log vs. merge-of-two-games-grows-
  into-multi-angle.
- **Lineup lock/edit rules** — when lineups lock; how mid-game edits are trailed.
- Recording **retention window** length (30? 45? season?).
- Paid **TURN** provider choice.
- Whether to run **SFU-for-everyone within the free tier** early vs. ship the P2P/SFU split
  from day one.
- Opponent-privacy display specifics (confirm jersey# + last name default).
