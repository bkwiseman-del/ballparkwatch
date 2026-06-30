# Bandbox — Master Plan (build + business)

> **Single source of truth.** Reconciles three earlier docs into one:
> - [baseball-app-build-plan.md](baseball-app-build-plan.md) — original technical phase detail (still useful for the scoring/video mechanics).
> - [bandbox-vision-market-wedge.md](bandbox-vision-market-wedge.md) — the field/facility **vision** (the "someday menu"); this plan sequences it but doesn't duplicate its depth.
> - ~~product-strategy.md~~ — **superseded by this doc** (kept only as history).
>
> **Brand:** Bandbox / **BANDBOX LIVE** · domains **bandbox.tv** (primary) + bandboxlive.com · pairing URL `bandbox.tv/go`. (Infra schema/bucket stay `bpw`/`bpw-audio` — not branding.)
>
> **Prime directive (scope discipline):** **v1 is the personal app for your own kids' games**, made genuinely great (streaming + stats). The facility/league wedge is **not v1** — but v1's *data model* must be **matchup-native and name-safe** so the wedge isn't blocked later. Build the spine right; defer the rest.

---

## 1. Product & positioning

**One line:** one parent broadcasts a youth baseball game from a phone; family watches in a browser (no app) with a synced vintage scorebug, stats, and AI commentary. Video optional; works stats-only.

**Two models, one product** (not either/or — see wedge doc §1–§2):
- **Core — sell to teams/families (primary, built first).** Stands alone, proves the product, seeds grassroots demand. **This is v1.**
- **Channel — sell to fields/leagues (later, higher-leverage).** *Same app, event log, viewer*, sold to whoever runs the **field** as a broadcast amenity; the crowd brings the cameras (QR → phones = multi-angle), sponsor-funded.

**The wedge — the asset-light triangle** (vs. a funded incumbent moving hardware-first: GC×Pixellot fixed cams Dec '25, CV auto-switch Mar '26, $449 GoPro/DICK'S bundle):
1. **No-install capture** — phones are the cameras; any field lights up today (only ~15% of facilities have fixed cams; rec fields ≈0%).
2. **No-app viewing** — just a URL; scan, watch in the browser.
3. **Family-free, sponsor-funded** — facilities/sponsors pay; families never do.
The incumbent can't follow without cannibalizing hardware sales, app engagement, and family subs. That's the durable space.

**Selling to existing GC users** (carry-over, still true): we're a **substitute, not a complement** — because our scorebug/announcer/stats are projections of *our* event log, broadcasting a game = scoring it in Bandbox. Enter through the **broadcast occasion**; **Segment A** (leagues that don't mandate GC) can fully switch = beachhead; **Segment B** (GC-mandated) keeps GC for the official record while we win the family's viewing. Attack what GC *monetizes* (broadcast), not its *lock-in* (stat history + league network); dissolve the lock-in with **GC data migration** (§7).

**Where we knowingly lag:** auto highlight reels, full team-ops, multi-sport, brand/distribution, network scale. We match GC on **stat depth** (§6) and **discovery** (§8) because both are cheap and on-strategy.

---

## 2. Architecture spine — matchup-native & name-safe (the v1 foundation)

Event-sourced: **`game_events` is the immutable truth; `game_state` is a cached projection** viewers subscribe to via Supabase Realtime. The reconciliation the wedge doc forces: **separate the physical event from each team's record of it**, and **attach broadcasts to the physical event, not to a team's book.**

**Three layers (wedge doc §"How it connects"):**
- **Field** — physical location (first-class; carries facility QR, sponsors, policy). *Optional — backyard games have no field.*
- **Matchup** — the actual contest on a field in a time slot. Owns the **field claim** and the **cameras**. One per field per slot.
- **Team-game** — one team's scorebook for that matchup: its own roster, scoring, families, privacy. Up to **two** attach to a matchup (home/away); **one is the common case**.

**The payoff: one set of camera feeds, two scoreboards.** Broadcasts attach to the **matchup**, so the away families watch the shared video with the *away* scorebug and the home families watch the same video with the *home* scorebug. Nobody films twice; nobody is forced into the other dugout's book. A camera doesn't "start a stream" — it **joins the matchup**.

**No scorebook reconciliation.** Two team-games are **independent records** of the same event (the official book legitimately differs from the other dugout's). Let both exist; **build no consensus/merge logic.** *(This reverses the old "merge into one canonical game" idea — that was over-engineering.)*

### Target schema (evolve the current `games`-centric model toward this)
```
-- Identity (durable) -----------------------------------------------------
leagues      (id, name, city, state, owner_id?, …)                  -- durable org; the rec through-line; later
teams        (id, owner_id, league_id?, canonical_name, sport, city, state, country,
              birth_year?, discovery, claim_status, …)              -- DURABLE team identity
seasons      (id, year, term[spring|summer|fall|winter], label)     -- canonical, platform/league seeded
team_seasons (id, team_id, season_id, display_name, age_group, level?, …)  -- a team's run in ONE season; games attach here
players      (id, team_id, name, number, …, name_display, name_consent?, do_not_stream)
roster_entries (team_season_id, player_id, batting_order?, position?)      -- per-season roster

-- Membership & access ----------------------------------------------------
team_members (team_id, user_id, role[owner|admin|scorer|broadcaster], status, invited_by, …)
team_invites (id, team_id, role, email?, token, expires_at, max_uses, uses, created_by, revoked_at)
broadcast_grants (id, matchup_id?, team_game_id?, token, label, created_by, expires_at, revoked_at, last_used_at)
field_devices    (id, field_id, credential, status, …)             -- field-mounted cameras; later

-- Physical event & books -------------------------------------------------
fields       (id, facility_id?, name, qr_slug, policy, sponsors, …)  -- pilot/later
facilities   (id, owner_id, name, …)                                 -- later
matchups     (id, field_id?, slot, claim_status, created_by, …)      -- the physical game
team_games   (id, matchup_id, team_season_id?, opponent_label?, lineup, visibility?, owner_id, …)
game_events  (id, team_game_id, seq, wall_clock_ts, inning, half, event_type, payload, …)
game_state   (team_game_id PK, inning, half, outs, balls, strikes, scores, runners, …)
broadcasts   (id, owner_type[field|matchup], matchup_id?, field_id?, angle, ingest_id,
              status, delay_ms, …)
```
- **`game_events`/`game_state` key on `team_game_id`** (each book is its own log/projection).
- **A team-game attaches to a `team_season`** (a Managed Team's run that season) **or carries an `opponent_label`** (a per-game string — never an entity, never discoverable).
- **`broadcasts` attach to a matchup** (a phone angle) **or a field** (a field cam that *promotes* into whatever matchup claims its field — later).
- **Viewer** = all `broadcasts` on the active matchup (shared angles + switcher) **+** the chosen **team-game's** `game_state` for that side's scorebug, aligned by the per-camera delay buffer.
- **Access is role-based, not single-owner** (see "Identity, roles & access" below): `team_members` grant owner/admin/scorer/broadcaster; RLS helpers (`can_admin_team` / `can_score_game` / `can_broadcast_game`) replace bare `owns_game`. Broadcasting is by **member identity or a scoped, revocable grant — never the viewer link**. Field/facility bind later. (Keep the `bpw` schema.)

**v1 migration note:** the current app is `games (home_team_id, away_team_id)`-centric with a shared log. The v1 refactor splits that into **matchup + up to two team-games, each with its own event log**, and moves broadcast association onto the matchup. This is the single most important v1 foundation task — cheap now, painful later.

### Team & season identity — durable vs per-season (travel ↔ rec)
**Continuity is an *action*, not a team type.** Every team is the same object; the only fork is whether you **roll it over** into the next season or **start fresh**. The system never *assumes* continuity, so rec teams don't get wrongly merged and travel teams get it in one tap.
- **`teams` is a durable identity; `team_seasons` is its run in one canonical `season`** (roster, schedule, games attach to the team-season). Identity is the `teams` id (+ optional **`birth_year`** cohort anchor), **not the name** — so a travel team can age up **11U → 12U** (per-season `display_name` / `age_group`) without breaking follows or career stats.
- **Travel / all-star (durable):** one team, many `team_seasons`. "Continue into next season" **copies the roster forward (bring everyone, then edit), bumps the age, suggests the name** — and **career stats accrue across all the team's seasons**. Families follow the durable id and keep following as it ages up.
- **Rec (ephemeral):** create a **new team each season** (the default action); each is one team with one season — no false continuity from last year's different kids. The durable through-line is the **`league`**, which groups each season's fresh set of teams.
- **Owner-linking is safe** (unlike opponent reconciliation, which we don't do): the *same owner* may link two of *their own* teams into one lineage after the fact. Low priority.
- **Deferred:** cross-*team* player identity (same kid on rec **and** travel) — genuinely hard, GC barely does it; **player career stays scoped to a team's lineage** for now.

### Identity, roles & access — three rings
Today everything collapses into one `owner_id` + one bearer `share_token` (the token authorizes *both* watching and broadcasting). Split into three independently grantable/revocable rings:
1. **Membership (identity).** `team_members` with roles **owner · admin · scorer · broadcaster**; invite by **email link** or **role-scoped join code / QR** (`team_invites` — expiring, revocable, max-uses). **Delegation is free** (§9). RLS moves from `owns_game` to role helpers (`can_admin_team` / `can_score_game` / `can_broadcast_game`); backfill an `owner` member for every existing team.
2. **Broadcast authorization (scoped capability) — never the viewer link.** A signed-in **member** broadcasts by identity (JWT + role). An **unauthenticated phone** (tripod / second device) uses a **member-minted `broadcast_grant`**: single-game, expiring, one-tap-revocable, distinct from the viewer share link; uploads go through a **signed URL minted against a valid grant** (this closes the current open-`bpw-video`-bucket hole). **Field cameras** authenticate with a **`field_devices`** credential and may attach only to matchups at that field **while the field is paid-enabled** (§9 field economics) — field-channel, later.
3. **Audience visibility (setting).** Who may *watch* (and whether the archive is kept/published) — the audience levels in §8 (members-only / link-only / public), kept **separate** from the broadcast/archive axis.

**Migration:** keep `owner_id` (it becomes the implicit `owner` member); **split `share_token`** so it stays the viewer link only and stop honoring it for `resolve_broadcast`/recording; generalize `owns_game` → role helpers.

### Name-safety chokepoint (build requirement)
**All name rendering runs through one shared `displayName(player, context)`** that *every* surface calls — scorebug, box score, play-by-play, **AI commentary audio** (it must not *say* a name shown only as an initial), highlight tags, share links, exports. Centralize it → leaks are impossible by construction. Scatter it → you'll expose a full name in the one place you forgot. (See §4.)

---

## 3. Video architecture — three engines, latency never the upsell

Both *phone* paths stay sub-second, free→paid; the only multi-second path is external/field cameras (RTMP), an inherent property of that ingest, not a tier we sell.

| Capture | Engine | Latency | Viewers | Records | Cost to us |
|---|---|---|---|---|---|
| Phone, small audience | **Mesh P2P** (built) | sub-second | ~5 | ✅ local→R2 | ~$0 (+ small TURN) |
| Phone, bigger audience | **Cloudflare Realtime SFU** | sub-second | dozens–hundreds | ✅ local→R2 | ~$0.045/viewer-hr; **1,000 GB/mo free** |
| External / **field** camera (RTMP) | **Cloudflare Stream / HLS** | ~few sec | 50+ (cap) | ✅ Stream-native→R2 | ~$0.06/viewer-hr |

- **YouTube is out** (field PA music = automated copyright strikes; a channel strike is existential).
- **Cloudflare Stream's WHIP/WHEP beta does NOT record** — so phones use our P2P + SFU, and Stream is reserved for RTMP cameras (external + **field cams**). Re-check CF roadmap.
- **Recording → R2** (zero egress, ~free replays): P2P/SFU via `MediaRecorder` on the broadcaster (chunked upload); cameras via Stream-native. **Free games get a 24h replay then auto-delete; paid (single-game/Team/Facility) keeps it** — season-long archive on Team (§9). Record best-effort on every game to enable the 24h window.
- **Cost-overrun protection** (now an *internal guardrail*, since families don't pay per-game — but we still must never eat unbounded egress): **50 concurrent-viewer cap** + paid upgrade for big games; overflow → free scoreboard (the pressure valve); our own metering breaker; default 720p; prepaid viewer-hour credits behind the sub/sponsor budget.
- **Broadcasts join the matchup**; **per-camera delay** (each angle calibrates its own latency, synced to whichever feed the viewer is watching). **Field cams** (facility-owned, persistent, promote into matchups) are a **later** phase — pipeline-wise just an external-RTMP source on a field-owned ingest.
- **TURN:** swap the free Metered relay for a **paid TURN** (the `ice-servers` Edge Function is already wired for it).

---

## 4. Privacy, consent & name-safety

Calibrate to **light-touch** (a product that over-restricts broadcasts nothing) and benchmark to GC: streams broadcastable by default, per-game audience toggle, only the permanent *archive* gated, consent pushed to the team/league. **Match that posture; differentiate on doing the consent *provably* and the de-identification *well*.** Full depth in wedge doc §"Privacy & consent model."

**Opt-out = de-identification, not de-filming.** A wide shot of a public game is covered by the league's media release + fence notice; the real concern is *naming / profiling / permanent findability*, which lives in the **data layer**. So an opt-out is a **database flag, not a video problem** (GC's own remedy for a minor is to *anonymize*, not delete).

**Names-down by default, opt up — system-wide (all via `displayName(player, viewer)`):**
- **Public default = first name + last initial** everywhere public-facing — the discovery default (§8). The render keys on the **viewer**: a **logged-in member of that team always sees full names** (they're the kids' own families/coaches); the public sees the team's chosen rung.
- **Full last names public = the one consent-gated rung.** An **admin/owner action tied to a "we hold consent for these players" attestation** (`players.name_consent` — timestamp + who certified), enabled only by the party that collected consent — never by us, never by one parent unilaterally. The first three discovery rungs (incl. names-down) are low-risk; **this rung is the legal one** (COPPA + state child-privacy).
- **Per-family downgrade always available** (first-initial, number-only, or no individual stat line). Defaults cascade; individuals can be *more* private, never less.
- **Live location is coarsened for anon.** A public/discoverable live game exposes **city/state + that it's live**, but **withholds precise field + exact timing from non-members** — "a 10U game in Austin is live" is fine; "this child is at this field right now" is not. Members and link-holders still get full detail.
- **Appearing at all = league policy, not engineering.** Must-not-appear (custody/safety): the league flags `do_not_stream`, doesn't stream that field, or hits the kill switch.

**Consent pushed upstream, three layers** (the league does the consenting; we make it easy + provable) — **field-channel scope, not v1 team product:**
1. **Contractual** — facility/league agreement: rep-and-warranty of obtained media releases, covenant to display signage + include release language, a **certification**, and **indemnification**.
2. **Operational** — *supply* it: ship consent signage with the QR printout, drop-in release language, and capture the certification as a **timestamped audit record** (the audit trail makes the indemnity defensible).
3. **Product** — per-game **audience toggle** (link-shareable default, one-tap "team/family only"), **live-only / no public archive** unless enabled, easy **takedown/kill**.

**v1 gets only:** `displayName()` chokepoint + names-down default, per-game audience toggle, live-only/no-public-archive default, and a kill switch. The contractual/operational consent machinery + moderation are **field-channel launch-gates** (§11/§12).

**Moderation & takedown** (crowd video = a duty; **field-channel** gate, not the team product): auth-to-broadcast; prominent **Report** + one-tap **kill** (kills one camera, others + scorebug survive); respond-by-killing not queuing; **CSAM = NCMEC reporting pipeline (vendor, not DIY)**; **Section 230/DMCA safe harbor is earned** by having/following the process. (Wedge doc §"Content moderation.")

**Don't over-trust the indemnity:** carry your own **media/tech E&O + general liability insurance**; get a **one-time youth-sports/privacy legal review** (COPPA + state biometric/child-privacy laws) before the first facility signs; fence signage is *notice*, the registration release is *consent*.

---

## 5. Platform — native scorer, web viewer

- **Viewer + setup → web, always** (the no-install share-link / cast-to-TV model is the moat).
- **Scorer/broadcaster → Capacitor native shell** (wrap the existing React/Vite app — *not* a React Native rewrite) for **background camera capture** (fixes the #1 video risk: iOS tab suspension/heat), robust recording, real offline, push, App Store trust.
- **Billing always on web** (Stripe ~3%) to dodge the 15–30% App Store IAP cut; unlock entitlements in the app.
- **Trigger:** build the native shell when the full-length **background-capture** + cross-network **paid-TURN** reliability tests fail as a pure PWA. ("PWA-now, native-later" with a concrete decision point.)

---

## 6. Stat depth — per player & team

Everything is a projection of `game_events`, so stats cost ~nothing → **free** (a wedge; GC charges for season stats). Materialize a `player_season_stats` rollup for performance; the log stays truth.
- **Batting:** AB, H, 1B/2B/3B/HR, RBI, BB, K, HBP, SB, R, AVG, OBP, SLG, OPS.
- **Pitching:** IP, H, R, ER, BB, K, ERA, WHIP, pitch count. **Fielding (later):** PO, A, E, FPCT.
- **Spans:** game (box score) → season → **career**. **Advanced (premium polish):** splits, spray charts.
- **Privacy:** only real Managed-Team players get cross-game/career profiles; a typed-in opponent (`opponent_label`) accrues stats only inside that one box score, rendered names-down via `displayName()`.

---

## 7. GameChanger migration — the lock-in solvent

Counter the #1 lock-in (sunk stat history) with **data portability**. (Rizzler/TurboStats already do GC import — proof it works.)
- **Importable (user-exported):** GC **Staff CSV** of season totals (batting/pitching/fielding) + roster. Optional on-brand path: extend the Claude-vision **lineup scanner** to OCR a GC stats-page screenshot → confirm → import.
- **Not importable:** the play-by-play log, video, spray charts. So we import **career totals as a read-only baseline**, stored as a **separate "prior totals" overlay** (labeled, summed into career displays) — **never into `game_events`** (keeps the spine clean).
- **Legally clean:** user exports their *own* data; **never scrape GC**. One-time migration, not a sync.

---

## 8. Discovery & public surfaces

Filterable directory (state · season · sport · age group) for network effects + SEO — **Managed Teams are discoverable by default**, name-safe. The admin sets **two independent controls** — the broadcast **audience** and the **discovery** of the data record — with player names governed by a separate rule.

**Only Managed Teams appear.** A **Managed Team** is a real, owned entity (`teams` row + members + roster). An **opponent** is a per-game `opponent_label` string — not an entity, no profile, **never discoverable**. (Cleaner than GC, which spawns ghost opponent-teams that orphan and clutter search.) Bulk-imported **migration stubs are `unclaimed` and hidden until a real owner claims/verifies them** (§7). Opponents are never auto-reconciled into teams.

**Don't conflate the controls** (the trap). There are two independent settings plus one names rule; a per-game override is the kill switch.

**① Broadcast audience — who can watch the video:**

| Audience | Who | Account? | In directory |
|---|---|---|---|
| **Members-only** *(max privacy)* | invited family/members only | **yes** — the privacy tradeoff | no |
| **Link-only** *(default)* | anyone with the share link | no | no |
| **Public** | anyone | no | yes |

**② Data-record discovery — the stats / score / schedule:** **discoverable by default** (a public, indexable, filterable page, names-down) or **private** (members + link only). Stats can be discoverable while the *video* stays link-only — separate axes.

**③ Names — `displayName(player, viewer)`, keyed on the viewer:**
- **Team members see full names by default** (a family can opt their own kid *down* — more private, never less).
- **Everyone else (link-only / public) sees first name + last initial.**
- The only way the public sees full names is the team turning on **full-names-public** — the one **consent-gated admin action** (§4).

So members-only buys privacy *and* (because members are signed-in) is the circle that safely sees full names; link-only is the everyday, account-free default; public adds findability. Names-down protects everyone the team hasn't deliberately exposed.

**Structured metadata makes filtering work** (controlled vocabularies, not free text): `teams` carry **sport** (baseball/softball), **city / state** (validated list), **country**, **age_group** (8U…HS-V), optional **level / league**; **seasons** are canonical (`year` + `term`), never typed strings. **Require state + season + age_group before a team can leave Private**, so the directory never fills with un-filterable ghosts.

**A game is discoverable transitively** — it lists if a Managed Team attached to it is discoverable, rendered from *that* team's names-down perspective; the opponent side stays a bare label. Durable **travel** teams are **one** directory entry with multi-season history; **rec** teams are **separate** entries per season (correct — they really are different teams), so the directory neither bloats with a travel team's copies nor falsely merges unrelated rec "Red Sox."

**Two reach modes:** **share-link** (no-account, always works, even for Private) + **directory/search** (the discoverable-by-default profiles). On an enabled field, the **fence QR resolves to the live matchup** — casual attendee scans, picks a side (or neutral scoreboard), no code shared. (Anon still gets the coarsened live-location per §4.)

---

## 9. Monetization — the model

**Goal:** the family never pays to *watch or broadcast* the everyday game, we never bleed on
the features that actually cost money, and we're visibly cheaper *and* better than
GameChanger. The mechanism: **draw the free/paid line along our *cost* line**, give a
generous free allowance, and make the **payer the team / sponsor / venue — never the viewer.**

**Free vs. paid splits on *cost* and *permanence* — the one-liner is "watch it live, free;
keep it, pay."**
- **Free forever — the *live* moment + the *data record*:** scoring, live scoreboard,
  play-by-play, box score, **full season & career stats**, **multiple team admins/scorers**
  (delegation is free), no-account viewing, share links, and **live mesh-P2P phone video**
  (~5 viewers, ≈$0 to us) **with a 24-hour replay**. **Permanent keep/archive is paid** — the
  free replay expires after 24h. (Stats/box score persist forever; the *video* expires.)
- **Paid — anything *produced, kept, or scaled*:** **scaled video** (SFU/HLS beyond the P2P
  handful), **AI commentary**, **highlight clips**, and **recording / replay / season
  archive** (the keepsake). Payer = a single-game buyer, the team, a sponsor, or the
  facility — **never the viewer**; a free *taste* of the wow comes first.

**What you're buying = one of two distinct goods** (watching is always free, so it's never a
differentiator):
- **Broadcast production** (scaled HD video + AI + the kept recording) — a **shared** good:
  one purchase upgrades *the game* for everyone watching. Sold at the **team / single-game**
  level.
- **Personal extras** (follow-my-kid pings, your kid's highlight reel + keepsakes, recruiting
  export, advanced personal stats) — a **private** good benefiting only that family. Sold at
  the **family** level.

### Tiers

| Tier | What you buy | Who buys | ~Price |
|---|---|---|---|
| **Free** | scoring · scoreboard · PxP · box score · **full stats (kept)** · **multiple admins/scorers** · unlimited no-account viewing · **live P2P video (~5 viewers) + 24h replay** · a taste of AI | nobody | $0 forever |
| **Single-game pass** | premium **broadcast** for **one game** — HD scaled video + AI + **kept recording**, everyone watches (**50-viewer cap**; bigger = upgrade) | anyone (parent, grandparent) | **~$8/game** |
| **Team** *(hero)* | premium **broadcast for the whole season — every game** (incl. the ones you're not even at) + **full-season archive** | the team / booster, once | **~$149/season** |
| **Family premium** | **personal** extras only — follow-my-kid, your kid's highlights/keepsakes, recruiting export (*not* the broadcast) | a family | **~$29/season** |
| **Facility / League** *(post-v1)* | premium broadcast for **every game at the venue** + field cams + fence-QR | the venue | negotiated |

**24-hour free replay (the taste); permanent keep = paid.** Free games are watchable live and
for **24 hours** after; keeping the video — plus the full-season archive, highlight clips, and
AI — is the paid upgrade. The recording is the keepsake families *want*, so the natural
conversion moment is *"this replay expires in 24h — keep it forever with a plan."* More
generous than GameChanger on the live + 24h window, while still gating the permanent archive
like they do. **Stats stay forever** on free; only the *video* expires. (We record every game
best-effort to enable the window; on free we auto-delete at 24h — storage is trivial and R2
replay egress is free.)

**Why Team beats buying single-games:** ~20 games × $8 ≈ $160 > $149, *and* one purchase, *and*
it covers away games the parent misses — so a committed team buys Team, while the occasional
big game (championship, grandparents in town) is the single-game pass. No free-rider hole.

**Sponsor offset — the lever GC can't match.** A team (or facility) sells flat sponsor panels
on the vintage scoreboard; that revenue can **cover or exceed the plan**, making it **free or
net-positive** — so "family never pays" holds at any scale and the product becomes a **booster
fundraiser**. (Later: tooling to help teams find/manage a sponsor.)

**Default buyer = the team** (GC's proven Team-Pass mechanic — one purchase, whole community
benefits — ~$90 under GC, and we *never* wall fans). Single-game + Family-premium exist so an
individual is never blocked or forced into a season commitment.

**Multi-user delegation is FREE — we don't paywall what GC gives away.** A team can have
multiple **admins, scorers, and broadcasters** (roles: owner · admin · scorer · broadcaster;
invite by email or role-scoped join code — see §2 "Identity, roles & access")
at no cost — matching GC's free team management, with a cleaner permission model tied to our
ownership/matchup design (each team-game has an owner; cameras *join* the matchup via a scoped,
revocable grant). Paid tiers
gate *broadcast production*, never *who can help run the team*. (Org/league-wide hierarchies
across many teams are a Facility-tier feature.) **General rule: never gate behind paid anything
GC gives free — delegation, scoring, stats — or the "obviously better value" claim breaks.**

### Why this hedges our costs
- **Free can't bleed:** free video is P2P (≈$0); generating scaled egress *requires* a paid
  unlock, and the **1,000 GB/mo SFU free tier** absorbs early growth.
- **The tail is capped:** 50 concurrent-viewer default + **scoreboard fallback** (overflow
  watches the free board, ≈$0) → a viral free game can't bankrupt us; big audiences buy a
  priced **big-game upgrade**.
- **Heavy paid teams stay profitable:** a heavy Team (≈20 games × 2 hr × ~25 viewers ≈ 1,000
  viewer-hrs + AI) costs us ≈ **$85/season**; at $149 that's healthy margin *before* sponsors.
  Light teams cost a few dollars.
- **AI** = templated routine calls + LLM only for highlights; **archive** on R2 (free egress);
  **billing on web** (Stripe ~3%, not the 15–30% App-Store cut, §5). The §3 caps/credits/
  metering run **underneath** as guardrails — simple tiers on top, meters hidden.
- **Every *paid* broadcast carries the 50-cap too** — even an $8 single-game can't bleed
  (50 × 2 hr ≈ $4.50 egress); a 1,000-viewer championship requires the priced big-game
  upgrade. The cap is what makes *every* tier's unit economics work, not just the free one.
- **Free's only real cost is cross-network TURN relay** (relayed P2P bandwidth for peers that
  can't connect directly) — bounded by the ~5-viewer cap; prefer direct P2P, use best-effort
  relay. Watch it at scale; it's the one place free isn't strictly $0.

### Field economics — a field is only "on" while a payer covers it
The field channel's danger (flagged on pressure-test): an enabled field + crowd cameras + a big
audience watching free = egress with **no payer**. We close it by rule — **"broadcast-enabled"
is a *paid facility/league* state (or sponsor-funded), never a free default:**
- **No payer → not enabled.** A plain field is just a venue; games on it fall back to **core
  rules** — free P2P (~5 viewers) or that game's own Single-game/Team payer. The **fence QR,
  field cams, and scaled public viewing are Facility-plan features** that switch on only while
  the facility/league (or a sponsor) is paying.
- **The facility is the payer — that's the model, not a leak.** Teams and families being free
  on an enabled field is the *feature*; the **venue + sponsor boards** cover the cost. "Lots of
  free teams, big audience" is fine *because the facility paid to light up the field.*
- **Guardrails still backstop it.** Facility plans bake in viewer-hour headroom with a
  **concurrent cap**; beyond it the **scoreboard fallback** + **metering breaker** cap our
  exposure, and a big tournament is a higher tier / per-event upgrade. Even a paid facility
  can't hand us an unbounded bill.
- **Field cams** honor **on/off hours** and the idle "standalone field feed" is capped too —
  all under the facility's paid budget.

So the answer to *"what if a huge audience watches and nobody paid?"* is: **that state can't
exist** — enabling the field *is* the payment, and the cap/breaker backstop even the paid case.

### Cost reference (confirmed June 2026)
Stream delivery $1/1k min (≈$0.06/viewer-hr); Stream storage $5/1k min; **Realtime SFU
$0.05/GB, first 1,000 GB/mo free** (≈$0.045/viewer-hr); **R2 $0.015/GB-mo, $0 egress**; mesh
P2P ~$0 + paid TURN; ElevenLabs per-minute. Per-viewer-game ≈ $0.09–0.12 for 2 hrs; replays
≈free on R2.

### Vs. GameChanger (make the value obvious)

| | GameChanger | Bandbox |
|---|---|---|
| **Cost to a family to watch** | $99/yr Premium (or $24.99/mo family plan) | **$0 — always** |
| **Watch video** | 5 free, then pay; fans can still be walled | **Always free — no account, no app** |
| **Season/career stats** | Premium ($) | **Free** |
| **Who pays for the team** | every family, *or* Team Pass **$239–449** *and fans may still pay* | **one ~$149 team buy covers everyone — or a sponsor does** |
| **Replay / archive** | Premium archive | **live + 24h free; permanent keep = paid** |
| **Multiple coaches/scorers** | Free | **Free** (we match — never paywall it) |
| **Team can *earn* on it** | No | **Yes — sponsor boards = a booster fundraiser** |
| **App required** | Yes (theirs) | **No — just a link** |

**The hammer:** *with GC a family pays ~$100/yr (or the team pays $239–449) and needs the app;
with Bandbox the family pays $0 and needs no app — one optional ~$149 team plan, often
sponsor-covered, unlocks HD + AI + keepsakes for everyone.*

**Where GC still wins (be honest):** the **league/tournament network** (a GC-mandated league
can't fully leave — Segment B), **years of stat history** (mitigated by GC import, §7),
**brand/trust**, **fixed-camera production quality** (Pixellot), and **team-ops depth**. We
don't win those — we win price, access, openness, family-free. That's why we **wedge**
(broadcast occasion + Segment A + asset-light fields), not frontal-assault.

**Prices are proposed anchors** ($8 game / $149 team / $29 family) — undercut GC and profitable
on the model above; validate with real usage; facility pricing is value-based (post-v1).

---

## 10. Offline-first scoring

Table stakes (dead-cell fields). The event-sourced model is built for it but it's a real item: **local-first event queue** in IndexedDB; UI optimistic, never blocks on network; sync on reconnect; **monotonic per-`team_game` `seq`** orders offline events and reconciles. Conflicts rare by design (one scorer per team-game). Prioritize early — it protects the source of truth.

---

## 11. The one-field pilot — "one field, one weekend" (rides on v1)

Prove the wedge thesis cheaply, on top of the personal app (wedge doc §"smallest pilot"):
1. Add to v1: a **per-field static QR** (`fields.qr_slug`) that resolves to **"the matchup on this field right now,"** and a **scan landing page** (`bandbox.tv/go` / field slug) with two buttons — **Watch** and **Broadcast**.
2. One local complex or tournament; print Bandbox QR signage for **one field**; recruit 2–3 parent broadcasters.
3. Run one weekend: every game on that field watchable by link, multi-angle when 2+ phones live, stats if anyone scores.
4. **Success = a distant family actually tuned in, a sponsor's name was on the board, and the facility says "put this on all our fields."** That sentence is the business case.

This is the *only* field-layer thing that touches v1, and it's deliberate — it's the cheapest possible test of the channel without building the channel.

---

## 12. Build sequencing

**Phase V1 — the personal app, rock-solid (the proof + the demo).** Get streaming-plus-stats genuinely great for your own kids' games. Within V1:
1. **Matchup-native + name-safe refactor** — evolve `games` → matchup + team-games (per-book event logs); broadcasts attach to matchup; the `displayName()` chokepoint. *(The forward-compat foundation — do this before piling on features.)*
1b. **Identity, roles & access + team/season model** (§2) — durable `teams` + `team_seasons` + `seasons`; `team_members`/`team_invites` (free delegation) with role-based RLS; **split `share_token`** so broadcasting moves to scoped `broadcast_grant`s (closes the open-bucket hole). The membership + broadcast-auth substrate everything else leans on.
2. **Offline-first scoring** — local event queue + `seq` reconcile.
3. **Stat depth** (season/career, per player & team) — projections; own-team rollups.
4. **Recording → R2** — `MediaRecorder` chunked upload (P2P/SFU); replay from R2; retention.
5. **Paid TURN + P2P hardening** — verify cross-network at scale; the reliability tests that gate the native trigger.
6. **Realtime SFU path** — sub-second scale tier; free→paid handoff ("let everyone in"); 50-cap + breaker + scoreboard fallback.
7. **One-field pilot mechanics** (§11) — field QR slug + scan landing (Watch/Broadcast). *Light; the only field-layer thing in v1.*
8. **Monetization plumbing** — web-checkout sub (Stripe) + entitlements; cost guardrails.

**Then (post-validation):**
9. **GC migration import** (§7) — switching lubricant.
10. **Discovery & public surfaces** (§8).
11. **External-camera (Stream/HLS) polish** + **field cams** (facility-owned, promote into matchups).
12. **Native scorer shell** (Capacitor) — at the reliability trigger (§5).
13. **Family premium** — follow-my-kid, keepsakes, recruiting export.

**Wedge phase — the facility/league channel (a real B2B company, not a weekend build):**
14. **Field & facility entities**, fence-QR → matchup, facility account + policy cascade, **sponsor boards**.
15. **Consent machinery** (contractual/operational/audit-trail) + **content moderation** (auth-to-broadcast, Report/kill, CSAM pipeline, safe-harbor) — **launch-gates before the open field channel goes live.**
16. **B2B sales/support/signage** + insurance + the one-time legal review.

**Deferred premium:** multi-angle is already implied by the matchup model; CV auto-switching, highlight reels, etc., only if validated.

---

## 13. What's hard (the honest part)

- **Coverage isn't guaranteed** — crowdsourced supply is what fixed cams solve. Mitigate: a designated team "anchor" broadcaster; let a facility drop in one cheap fixed anchor cam; sell "enables broadcasting," not "guarantees every game."
- **Quality gap** — phone angles vs. Pixellot's automated production. The bet: *good enough, free, on every field* beats *great, on 15% of fields*.
- **Privacy/child-safety is gating** for the field channel — handled by the upstream model in §4; still get the lawyer.
- **Contested, funded category** — ambition isn't "beat GameChanger"; it's **own the asset-light / no-app / family-free niche**, win locally/regionally, or build something acquirable.
- **B2B reality** — parks departments and leagues move slowly.

---

## 14. Decisions & open questions

### Decided
- **Rebrand → Bandbox / BANDBOX LIVE** (bandbox.tv); `bpw` infra schema unchanged.
- **Unified plan** — this doc supersedes product-strategy.md; wedge doc kept as the vision reference.
- **Matchup-native spine** — Field→Matchup→Team-game; **broadcasts attach to the matchup**; **no scorebook reconciliation**; **`displayName()` chokepoint**. v1 builds the schema; only team-game + pairing-code/QR camera-join + the one-field-pilot are wired.
- **Team & season identity** (§2) — durable **`teams`** + **`team_seasons`** + canonical **`seasons`**. **Continuity is an *action* (roll over), not a team type:** travel teams roll over (roster copies forward editable, ages up 11U→12U, **career stats accrue**, identity = id not name, optional `birth_year` anchor); rec teams start fresh each season under a durable **`league`**. Owner-linking your *own* teams allowed; **cross-team player identity deferred**.
- **Identity, roles & access — three rings** (§2). **Membership:** `team_members` roles **owner · admin · scorer · broadcaster** + `team_invites` (email or role-scoped join code), **free delegation**; RLS moves `owns_game` → role helpers. **Broadcast authorization:** by member identity **or** a scoped, revocable **`broadcast_grant`** — **never the viewer share link**; signed-URL uploads close the open-bucket hole; field devices (paid-enabled fields only) later. **Visibility** is a separate setting (the §8 ladder).
- **Discovery & visibility (§8)** — two independent controls + a names rule. **Broadcast audience:** members-only / **link-only (default)** / public. **Data-record discovery:** **discoverable by default** (stats/score page, names-down) or private. **Names:** **members see full names by default**; link-only/public see first + last initial unless the team enables **full-names-public** (the one **consent-gated admin action**). Live location coarsened for anon; **structured metadata** (state/season/sport/age_group) required before a team leaves private. **Opponents never discoverable; migration stubs unclaimed/hidden.** *(Resolves the old "Discovery default" open question.)*
- **Monetization (§9): "watch it live free + 24h replay; keep it, pay."** Free = live moment + data record (scoring, scoreboard, **full stats kept**, **live P2P video + 24h replay**, **multi-user delegation**). Paid = produced/kept/scaled (scaled video, AI, **permanent recording/archive**, highlights). Two goods: **broadcast production** (shared → **Single-game ~$8** or **Team ~$149/season** hero; **all paid broadcasts capped at 50 viewers**, bigger = priced upgrade) vs **personal extras** (private → **Family ~$29/season**). **Facility** post-v1. **Sponsor offset** can zero it out; caps/breaker are internal guardrails.
- **24-hour free replay** (the taste); permanent keep = paid. *(Resolved: 24h, not a hard gate.)*
- **Multi-user delegation is FREE** (admins/scorers/broadcasters) — match GC, never paywall it; org/league hierarchies are Facility-tier. General rule: don't gate what GC gives free.
- **Field economics:** a field is **"broadcast-enabled" only while a payer (facility/league or sponsor) covers it**; no payer → core rules (free P2P / own-payer). Closes the "huge free audience, nobody paid" hole; cap + metering breaker backstop even paid facilities.
- **Two-model business**, core (v1) first, facility channel later, same product.
- **Privacy:** opt-out = de-identification; names-down default (first name + last initial), opt-up by the consenting party; appearing = league policy; consent pushed upstream (field-channel scope).
- **Platform:** native scorer (Capacitor) / web viewer; billing on web; native at the reliability trigger.
- **Video:** three engines (P2P/SFU/Stream-HLS); YouTube out; latency never the upsell; record→R2; 50-cap guardrail.
- **GC migration**, **stat depth (free)**, **offline scoring**, **discovery (privacy-gated)** — all carried forward.
- **One-field pilot rides on v1.**

### Still open
- **`games` → matchup/team-game migration plan** — audit current schema/code; phased cutover.
- **Segment focus** — are local target leagues mostly Segment A (switchable) or B (GC-mandated)? Start with your own kid's league.
- **Validate price anchors** — Single-game ~$8, Team ~$149/season, Family ~$29/season are proposed (undercut GC, profitable on the §9 cost model); test real willingness-to-pay and usage.
- **Facility cap/headroom + tournament pricing** — the per-tier concurrent cap, viewer-hour headroom, and per-event upgrade for big tournaments (the field-channel cost-control knobs).
- **Facility channel pricing** — per-field vs per-facility; seasonal rate; sponsor-revenue split.
- **Sponsor mechanics** — do we broker/manage team sponsors (tooling, cut) or just provide the scoreboard slot?
- **Native trigger timing** — wrap the scorer in Capacitor now (de-risk capture) or strictly after the PWA reliability tests fail?
- **Migration scope** — CSV-only first, or also the stats-page OCR? How many past seasons.
- **v1 stat list** — how far into advanced/fielding; any paid stats vs all-free.
- **Recording retention window** (30/45/season); **paid TURN** provider.
- **Cross-team player identity** — same kid on rec **and** travel; deferred (hard, GC barely does it). Revisit if career profiles demand it.
- **League modeling depth** — how much org/season hierarchy to build now vs stub (rec through-line vs the later facility/consent anchor).
- **Consent-attestation UX** — the exact admin flow + audit record that gates the Public-+-full-names rung (the COPPA-sensitive one), and the youth-privacy legal review that should precede it.
- **Pilot target** — which local complex/tournament, and when.
