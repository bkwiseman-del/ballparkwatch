# Bandbox — Game & Broadcast Workflow: Canonical Build Plan

> **Single source of truth** for how the game/broadcast system fits together, plus the cross-cutting build constraints decided this session. Supersedes the scattered explanations in earlier docs. Companion docs (vision/market-wedge, competitive-and-IP memo, competition/IP/simulcast brief, growth-and-reliability notes, packaging-and-pricing) are referenced for depth. Handoff for Claude Code.
>
> **Guiding requirement:** this must be *extremely intuitive to understand, explain, and build*. Every piece is an optional layer that snaps onto one shared game; the pieces must never fight each other.

---

## Part 1 — The core mental model: a game is a "room"

The confusion in this domain comes from treating "a broadcast" as one blob. It's actually **four independent things** that stack:

1. **The game** — one physical contest. Exactly one; everyone shares it. *(the "room")*
2. **Cameras** — video angles on that game. Zero to many. Shared by all.
3. **Scoreboards** — each team keeps its own. Zero, one, or two.
4. **Audience** — each team brings and serves its own families.

> **A game is a room. Cameras join the room and add angles. Teams join the room and each hang their own scoreboard. Families watch the room through their team's scoreboard. A Bandbox field is a permanent front door to whatever room is active on it right now.**

Every scenario is just a different **count** of cameras (0–many), scoreboards (0–2), and audiences on **one** room. Nothing else changes. That's the whole system in one breath.

**Name mapping:** room = **matchup**; a team's scoreboard-and-roster in it = **team-game** (a "seat," max 2); an angle = **broadcast**; the front door = **field + QR**.

---

## Part 2 — Entities & data model

- **team** — persistent, admin-owned object: name, org/league, age/division, town, coach name, logo/colors, **members**, and an **active join code**. *Membership is the credential.*
- **matchup** — the room. Optional `field_id`. Holds up to two seats. Owns the field claim + the cameras.
- **team_game (seat)** — one team's presence in a matchup: its roster, scoreboard, privacy settings, and audience tier. Max two per matchup. State: **ghost/provisional** or **claimed**.
- **broadcast** — a camera angle. `owner_type [field | matchup]`. Field-owned cams **promote** into the matchup when one claims the field, **fall back** to a bare field feed otherwise.
- **field** — facility-owned: `qr_slug`, consent/privacy policy, sponsors, optional field cameras.
- **player / lineup_entry** — belongs to a team; rendered everywhere via `displayName()`.
- **game_event** — the event-sourced **stats spine** (source of truth). **game_state** — cached snapshot for fast reads.
- **provisional data** — anything entered against an unclaimed seat (a ghost name, a running score); always overridable by the real owner on claim.

---

## Part 3 — Ownership rules (what stops the pieces fighting)

These five rules are load-bearing. They resolve every "who controls what" conflict.

1. **Opening a room owns nothing.** You own only what you *bring* — a camera you add, or a seat you claim. There is no "room owner."
2. **Camera contribution and seat claim are independent actions.** Neither blocks the other. A camera contributor has no claim on any scoreboard; a team has no claim on anyone's cameras.
3. **Seats are credential-gated.** A seat is claimed only by someone with rights to that team (see Part 4). A rando can never take a real team's seat.
4. **Claimed supersedes ghost/provisional; scoreboards belong to seats.** There is no single room scoreboard — each seat has its own board. An unclaimed seat's board is provisional; the instant the seat is claimed, the provisional board yields to the owner (with a keep-or-reset handoff).
5. **One room per physical game.** You always *create* the room or *join* it — never duplicate it. The field QR enforces this when present; a pairing code does it otherwise.

---

## Part 4 — Teams, credentials & claiming

**A user can act for a team if they are:** a team admin, a member the admin added/approved, or a holder of the team's active join code. "Credentialed to claim this game for Team X" simply means "you belong to Team X."

**A seat gets bound to a team three ways — all reduce to the membership check:**
- **You created the game** for your team (from its schedule or "new game") → you own the seat by construction.
- **You hold the code** (opponent/pairing/field code) → proves you're here for that team.
- **You're a member opening your team's scheduled game** → the schedule ties the game to your team.

**Team search (picking a real opponent) — confirm identity without exposing kids:**
- Results show **org-level identifiers only**: team name, town/city, league/association, age group/division, coach *name* (not contact), logo/colors.
- **Never in results:** rosters, player names, schedules, contacts, or any child data.
- **Confirmation step before binding:** "Connect to *Riverside Reds — 10U, Metro West, coach J. Alvarez*?"
- **Binding is a mutual handshake, not a unilateral fuse.** Picking a team sends a *request* (or requires their code); **nothing sensitive crosses until the other team accepts.** Wrong pick → harmless declined request, zero leak.

---

## Part 5 — Ghost opponents & ghost-first playability

**A ghost opponent is an unclaimed seat with a label + a join code — a joinable vacancy, never a dead string.**

**Ghost-first is the golden rule: your game NEVER waits on anyone.**
- You create the game (opponent as a ghost name), optionally scan the field QR, and **start scoring + streaming immediately** — full function, depending on nobody.
- The opponent becoming a real linked team is an **optional, asynchronous upgrade** that can land **pre-game, mid-game, or never**, with no effect on your ability to play.
- Accept pre-game → two boards from first pitch. Mid-game → their board lights up from that point. Never → you played a complete, scored, streamed game against a ghost and never noticed.

**Conversion in place:** when the real team claims the seat, the same seat converts — the label is replaced by their real roster, board, admin, privacy. Provisional data (name, running score) is offered **keep-or-reset**, never silently overwritten.

**Lineup trading** exists only once *both* seats are real teams (each publishes its own roster, each edits only its own). No accepted opponent → no exchange yet; degrades gracefully, never blocks play.

**UI nudge:** push **"search for your opponent"** first; treat "type a ghost name" as fallback — but always generate the join code so the ghost stays convertible.

---

## Part 6 — Field QR: the front door

**A field QR is a permanent link to "this physical field," not to any one game.** Scanning always asks: *"what's active on this field right now?"* and routes on who you are.

**Scanning to set up (the playing team):** binds their game to the field. This (1) auto-pulls any **field cameras** into the game as angles, and (2) makes the field know which game is live, so others who scan get routed to it.

**Scanning to watch/join (anyone else at the field):**
- Game bound + someone scoring → **routed to that game's viewer** (pick a side, watch).
- Cameras live, no scoring → **routed to the video** (bare field/broadcast feed).
- It's *their* team playing and they're a member → offered the **claim / co-score** path.
- Nothing active → "no game live here right now" (or the bare field cam if one exists).

One sticker on the fence does setup, discovery, viewing, sharing, and the join-your-own-team path — because it resolves to "the active game on this field," then branches on identity.

---

## Part 7 — Camera angles (shared pool, per-audience defaults)

Cameras are the shared layer of the room. Three rules make them work: **shared pool, per-audience default, low cap.**

**Shared pool.** Every camera is a broadcast attached to the *matchup*, and every angle is watchable by everyone (subject to the audience/privacy gating below). There is no single "the broadcast" — there's a set of live angles and the viewer's player has a switcher. Multiple phones on one game = multiple selectable angles for free.

**Cap live angles low.** Not unlimited — each live angle is another ingest, another thing to moderate, another choice to burden the viewer with. Target **~3–4 crowd angles per matchup**; beyond the cap, contributors queue or are declined. The **field/anchor cam gets a reserved slot** and doesn't count against the crowd cap. Few good angles beat many bad ones.

**Primary feed is a per-AUDIENCE default, not a global one.** There is no single matchup-wide primary. Each audience has its own default view into the shared pool:
- **Each team sets its own primary angle for its own families** — home's admin picks home's default, away's picks away's. Neither can override the other (each sets only its own side's default), and neither can make an angle private or remove it from the pool — they set a *default*, not *ownership*.
- **The neutral / public / field-QR viewer** (belongs to no team) gets the **matchup neutral default**.
- **Fallback priority for any default:** anchor/field cam → creator-designated angle → first available. Setting a primary is an optional refinement; whoever doesn't choose still gets a sensible default.
- **Manual override, not forced automation:** seat owners set their own default; the field/matchup creator sets the neutral default. Priority is *assignable* (a human knows which phone is the steady tripod shot). **No AI auto-switching in v1** — it's CV work, patent-adjacent (Pixellot/GameChanger), and manual primary + viewer choice is simpler, cheaper, and safer.

**Switching (per viewer, lean-back-safe):**
- The default primary plays with **no interaction** — the grandparent never thinks about angles.
- An unobtrusive **labeled switcher** ("Cameras (3)") for engaged viewers; **label by role** ("Home side," "3rd base," "Field cam"), never raw camera IDs.
- **Switching is per-viewer** — one person changing angles affects no one else.
- Each angle carries **its own delay/sync**, so the scorebug re-syncs to the chosen feed's latency on switch (per-broadcast delay buffer).

**Single-angle surfaces use the primary only.** The **public simulcast** (YouTube/FB) is single-angle by design → it sends the relevant **primary** feed, not the whole pool; secondary angles are an interactive-viewer luxury that never goes to third-party platforms. TV cast and the neutral field-QR viewer likewise get a primary, not a switcher-heavy experience. (If each team runs its own simulcast, each pushes its *own* primary; a shared/field simulcast uses the neutral default.)

**Angle vs. privacy are independent dials.** *Which camera* you see (angle) is separate from *whether you may watch* and *what names show* (privacy):
- **A private team's angle is never served to a neutral viewer.** Angles inherit the audience-permission of whoever owns them — a team's contributed camera inherits that team's privacy; the field's camera inherits the field's policy. So the public/neutral lane can only ever be served a **field-owned feed**, never a private team's angle.
- **Both teams private:** there is no public game audience. A neutral scanner gets the **field feed** if the facility offers one (de-identified to the floor, no team rosters) — or **nothing** ("not publicly available"). **Recommended default: both-teams-private suppresses the neutral field feed too**, unless a team explicitly opts into the field's public lane — so privacy is never weakened as a side effect of playing on an enabled field.
- **Both teams public:** there's a real neutral audience; it gets the **neutral default angle** (anchor → designated → first available) from the shared pool — not either team's primary. Each team's families still get their own default; anyone can switch to any angle. Identity still renders per each team's own setting with the stranger-floor applied (public *access* ≠ public *names*).

**In one line:** cameras are a shared pool; "primary" is a per-audience default (each team its own, the neutral public its own); caps stay low; viewers switch per-person; single-angle surfaces take the primary; and a private team's angle is never exposed to a neutral viewer.

**v1 note:** your own game is one camera, so this collapses to: support one angle now, but build the *primary-feed* and *switcher* concepts so adding a second phone later is a slot, not a rebuild.

---

## Part 8 — Free vs paid (per-seat audience)

Because every viewer watches **through a team's scoreboard**, the **viewer cap lives at the seat level** — each team serves its own audience at its own tier. A free team and a paid team can share the exact same game with zero conflict.

- **Free:** up to ~5 concurrent viewers (frame as "family-sized and private," not crippled).
- **Paid:** up to ~50 concurrent; **add-ons** for more, metered/capped so price tracks cost.
- **Field/neutral viewers** (scanned the fence, no allegiance) ride the **field's facility plan**.
- **Broadcast-only** (no team) is capped by the **broadcaster's own plan**.

**Cost basis (Cloudflare Stream):** ingress + encoding + adaptive-bitrate transcoding are **free**; you pay **~$1 / 1,000 viewer-minutes** delivered, plus storage only if recording. So per-viewer pricing tracks real cost. Live-only (default) ≈ $0 storage. (See packaging-and-pricing doc.)

**Broadcast-only tier = the front door.** Optional **basic scorebug** (score/balls/strikes/outs) is just a **provisional board on a seat** — no separate feature. Position broadcast-only on **privacy + simplicity vs. free YouTube**, not on "free video."

---

## Part 9 — Privacy model across every scenario

**Foundation (build once, apply everywhere):**
- A single **`displayName(player, context)`** function is called by **every** surface — scorebug, box score, play-by-play, **AI commentary audio**, burned-in overlays, share links, exports.
- **Public default = first name + last initial.** Full names = **league/team opt-in** (tied to consent certification). **Per-family downgrade** always available. **Number-only** tier underneath.
- **`context` (who's watching) changes what's returned:** a team's own confirmed family may see the team's chosen level; **strangers, field-scanners, and public surfaces get the conservative floor.** If a surface can't identify the viewer, it **assumes stranger and shows the floor.**
- **Live-only, no public archive** by default. **Facility sets the floor** when a game is bound to a field (a team can be more restrictive, never less). **Do-not-stream** (custody/safety) is an absolute upstream league flag.

**Per scenario:**
- **Broadcast-only (no scoring):** no player identities exist; only the video is a privacy surface (governed by field/league consent + moderation kill switch).
- **Broadcast-only + basic scorebug:** the board is **team-level** (score/B/S/O), inherently anonymous — a rando has no roster and no credentials to publish names.
- **One claimed team + ghost:** your players render at *your* team's settings; the ghost side has no roster to expose.
- **Two claimed teams:** **each seat carries its own privacy settings independently.** A's opt-outs never touch B's feed. Exchanged lineups still render each at its own team's level. Nothing crosses seats.
- **Field / neutral viewers:** most conservative view (identification at the floor) regardless of team opt-ins; full names only ever to a team's *own* confirmed families, never to an anonymous scanner.
- **Simulcast (YouTube/FB):** hardest de-identification (floor regardless of team setting); mic off / AI-commentary audio so the booth never *speaks* a name the overlay hides.

**Ghost-opponent player data (the side that can't consent):**
- **Number-first entry.** Default opponent players to **jersey number only**; name is optional and discouraged. Numbers identify nobody outside the single game.
- **Render the ghost side number-only on all public surfaces**, regardless of what the scorer types locally.
- Manually-entered opponent names are **ephemeral, unverified working data** — never elevated to full-name display, never spoken by the AI booth, never built into a searchable/persistent profile, never accumulated across games.
- **Real roster supersedes on claim:** when the opponent claims the seat, their consented, owned roster (at *their* privacy settings, controlled by *their* families) replaces the provisional entries.
- Principle: **stats want continuity, privacy wants ephemerality — for un-consented opponent kids, privacy wins.** No non-consensual cross-game dossiers.

**Load-bearing build requirement:** `displayName()` must receive a trustworthy `context` on every surface (including audio + burn-in). No trustworthy context → assume stranger → show floor.

---

## Part 10 — Cross-cutting build constraints (from tonight's other threads)

Concise here; depth in the referenced companion docs.

**IP design-around (competitive-and-IP memo):** Do **NOT** implement "tap a rendered baseball-field diagram to mark hit location" as a scoring input (GameChanger US 8,731,458 / 9,393,485, active to 2029–2030). Capture location via a **fielder + trajectory** model (tap the fielder + hit-type + depth + direction). **Spray charts (output) are fine** — competitors (iScore drag-the-glove, SidelineHD tag-the-fielder) do exactly this. FTO watchlist before commercializing: Sports Logic Group (event-data↔video), Ease Live (overlay-sync), Pixellot + GC dynamic-video (CV auto-framing), GC US 12,496,524 (auto-media). Not legal advice.

**Reliability = the moat (growth-and-reliability notes):** positioning is **"never dies, not never drops."** Build: reconnect-not-fatal (assume the connection *will* drop, buffer, auto-resume); **stats/video orthogonality** (a video failure can't kill the scoreboard and vice-versa); **upload-side adaptive bitrate** (capture reduces its encode bitrate on weak upload — *free*, reliability-critical) vs. **delivery ABR ladder** (Cloudflare, transcoding-included, costs per viewer-minute); **local recording caveat** — external RTMP cameras record to their own SD card robustly, but **browser/PWA `MediaRecorder` local recording is best-effort** (storage quotas, tab suspension, crash/battery risk), so **server-side recording (Cloudflare) is the reliable path but only captures what was uploaded** (gaps if the stream drops); **multi-angle failover** (matchup survives one camera dropping); **wired/anchor uplink for facilities** sidesteps congested cellular. Test at the dead-signal corner of the worst local field.

**Simulcast (competition/IP/simulcast brief):** three output tiers (owned viewer = full, HTML-overlay scorebug, multi-angle, real/synthetic audio choice; public simulcast = lite, burned-in scorebug + burned-in CTA/QR, single angle; stats-only). Burn-in required for third-party platforms (you don't control their player); **phone-WebRTC path needs a server restream/transcode hop to RTMP**. Funnel = auto-populated deep link in the description + burned-in CTA/QR back to Bandbox. **Audio (copyright-critical): camera mic OFF on public simulcasts; audio = AI commentary + owned/royalty-free crowd SFX** (FB/YT Content ID auto-flags copyrighted PA/walk-up music). Competitors have no auto-fix (they tell users to add an announcer) — Bandbox **ships the announcer**.

**Moderation (field channel launch-gate, not the team product):** auth-to-broadcast (watching open, contributing gated); prominent Report + one-tap kill; **cut immediately, don't queue**; default live-only/no-archive; CSAM = legal reporting pipeline (NCMEC + established vendors), lawyer before the field channel goes live.

**No GameChanger API:** GC stats don't leave their platform live → a GC-scoring parent is **video-only** in Bandbox; the viewer must degrade gracefully to a no-scorebug state. Optional post-game CSV import only; never architect a live dependency on GC data.

**Consent (facility/league onboarding):** push consent upstream via contractual certification + indemnity + supplied signage/form language + a timestamped audit trail; carry own insurance; one-time legal review for minors' data; signage is notice, the registration release is the consent. (Vision doc.)

---

## Part 11 — Build phasing (keep v1 clean)

**Foundational from day one (never skip):** the event-sourced stats spine, video/stats orthogonality, and the single `displayName(player, context)` function.

- **v1 — personal use:** one team + ghost opponent, your own camera, scoring + scorebug, own viewer, broadcast-only tier, basic reliability (reconnect, upload-side adaptive bitrate, local/server recording). Number-first opponent entry. No multi-team linking, no field/facility, no simulcast, no AI booth.
- **Phase 2:** pairing/claim flow + two real teams + lineup trading; simulcast + funnel + synthetic-audio public tier; TV casting.
- **Phase 3:** fields / field QR / field cameras / facility accounts + consent certification + moderation; booster sponsor tools; parent-pull "request Bandbox at your field."
- **Phase 4:** AI commentary booth; auto-recap; shareable vintage keepsakes.
- **Phase 5:** vision-assisted scoring (R&D, assist-and-confirm, not autonomous); smart-TV apps (casting → web-based Fire TV/Samsung/LG → Roku → Apple TV).

---

## The whole system in one breath

**It's one game room. Cameras and scoreboards snap onto it as optional layers. You own only what you bring — a camera or a credential-gated team seat — so nothing you start locks anyone else out. Your game plays immediately against a ghost; the real opponent can upgrade the empty seat anytime or never. The field QR is a permanent front door that binds a game to a field and routes everyone else to whatever's active. Each team serves and pays for its own families, and every name on every surface passes through one privacy function that shows less to strangers and nothing it shouldn't.**
