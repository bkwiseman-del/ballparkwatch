# Bandbox — Vision & Market Wedge

> A "where this could go" doc, deliberately kept **separate from the build plan**. None of this is v1. v1 is the personal app for your own kids' games — and that working app is the proof-of-concept and the demo that makes this vision sellable. Build it first; treat everything here as a someday-menu to validate only after streaming-plus-stats is genuinely great.

---

## Two models, one product (not either/or)

**Core product — sell to teams/families (primary).** This is the main business and the thing built first: one parent broadcasts, family watches in a browser, with stats and AI commentary, no facility required. It stands on its own, it's the proof that the product works, and it's the grassroots demand that makes the bigger sale possible later. This is the go-to-market.

**Expansion channel — sell to fields/leagues (additive, higher-leverage).** The *same app, same event log, same viewer* — sold to whoever runs the **field** (complex, league, parks department, tournament) as a paid "this field is broadcast-enabled" amenity, with QR signage layered on top. The twist that makes it cheap: **the crowd brings the cameras** — parents scan a QR to broadcast from their own phones, multiple phones become multiple angles, viewers watch in a browser.

These two reinforce each other rather than compete. Team/family adoption proves the product and seeds the demand a league responds to; the field deal is just a wider distribution channel for the identical product, where the unit of adoption scales from the team up to the field and one facility relationship onboards every team and family passing through it. Selling to fields doesn't replace selling to teams — it sits on the same foundation.

---

## How it connects: field → matchup → team-games

The mechanism that lets both models run on one product: **separate the physical event from each team's record of it.** Three layers:

- **Field** — the physical location (first-class entity; on a Bandbox-enabled field it carries the facility's QR, sponsors, and policy).
- **Matchup** — the actual contest on that field in that time slot. It owns the **field claim** and the **cameras**. One matchup per field per slot.
- **Team-game** — one team's scorebook for that matchup: its own roster, scoring, families, and privacy settings. Up to **two** attach to a matchup (home and away).

The thing that makes two teams coexist on one field: **broadcasts attach to the matchup, not to a team-game** — the camera is filming the field, and there's only one physical game to film. So you get **one set of camera feeds, two scoreboards.** The away families watch the shared video with the away scorebug; the home families watch the same video with the home scorebug. Nobody films twice; nobody is forced into the other dugout's book. A camera doesn't "start a stream" — it **joins the matchup.**

**At game setup, "Where are you playing?"** — three options:
- **Scan the field QR**, or
- **Search / pick** a nearby Bandbox-enabled field (geolocation helps), or
- **No field / unlisted** — a backyard or non-enabled park. (Core product still works with no field at all; field binding is an enhancement, never a gate.)

When a matchup is bound to a field, the field becomes the rendezvous and coordination mostly disappears:
- The field's **static fence QR resolves to that matchup** — a casual attendee scans, lands on it, and picks which side to follow (or sees a neutral both-teams scoreboard), with nobody having shared a code.
- **Cameras inherit the field** — a broadcaster joining via the fence QR attaches to the matchup already anchored there; scorers and cameras don't swap codes, they both reference the field.
- The **facility account attaches automatically** — sponsor boards, consent/privacy policy, and field settings flow down without anyone configuring them.

**Who creates the matchup:** the **first team to bind to the field creates it; the second team joins the existing one** as the other side ("join the game already here as the other team?") rather than spinning up a duplicate. One physical event, up to two books.

**Joining, then, has doors for both people and cameras:**
- **Field (scan QR or search) at setup** — binds the team-game to the matchup on that field; preferred path on enabled fields.
- **Pairing code / QR** — the scorer's screen shows a code; a broadcaster opens `bandbox.tv/go`, scans/enters it, and joins the matchup. Works with no field at all (backyard games). Several cameras can join → multiple angles for free.
- **Confirmed member** — a logged-in family/player sees the team's live or next game and taps "Add camera."
- **Schedule** — if the team has one, pick today's game.

**Field cameras — a field can own a broadcast, too.** A facility can wire its own fixed camera(s) into a field. A field cam is just a broadcast whose **owner is the field** rather than a person — persistent and always-on (per schedule). When a matchup claims the field, the cam **promotes** into it as one more angle beside the parents' phones (same scorebug overlay, same angle switcher). When no matchup is live, it's a standalone **field feed** — scan the fence QR or find the field and watch whatever's happening (warmups, a scrimmage, "is it raining at the complex"), no game, no scorebug. When the matchup ends, it drops back to a bare feed. The field owns a persistent broadcast; matchups borrow it while they exist.

This makes the field cam the **optional anchor** that hedges the coverage risk: a facility wanting assurance drops in one fixed cam so every game has at least one feed even when no parent films, and phones add angles on top — so the crowd-sourced model and the fixed-camera model stop being either/or. Specifics: it lives under the facility's account and policy; it needs on/off hours so it isn't broadcasting an empty field at 2am; and because a fixed cam only ever points at the field, it's the low-risk, more-trusted source (reasonably auto-published, unlike a stranger's phone). Pipeline-wise it's nothing new — the external-RTMP/WHIP source already in the build plan, pushing to a field-owned ingest.

Underneath: `fields (id, facility_id, name, qr_slug, policy, sponsors, …)`, `matchups (id, field_id?, slot, claim_status, …)`, `team_games (id, matchup_id, team_id, roster, privacy, …)`, and `broadcasts (id, owner_type [field|matchup], field_id?, matchup_id?, label/angle, ingest_id, status, …)` — a broadcast belongs to a **field** (a field cam) or a **matchup** (a game angle), and a field-owned one promotes onto whatever matchup claims its field. The viewer reads every `broadcast` resolving to the active matchup (promoted field cam + phones) for the shared angles, plus the chosen **team-game's** `game_state` for that side's scorebug, aligned by the delay buffer; more than one broadcast → an angle switcher.

Details that make it play nicely:

- **The field claim lives on the matchup, not the team-game** — which is why two teams don't fight over the field. One matchup owns the slot; the two team-games sit inside it. The claim **expires when the matchup ends** (tournaments turn fields over fast).
- **One team is the common case.** A matchup with a single team-game attached works fine; the second slot just stays empty. Two-team is the rich case, not the required one.
- **No scorebook reconciliation.** Don't try to merge two teams' books into one truth — they're independent records of the same event (the official book legitimately differs from the other dugout's). Let both exist; build no consensus logic.
- **Privacy stays per team-game.** Each team carries its own roster and name-display settings; the away team's opt-outs never touch the home feed. When bound to a field, the **facility sets the floor**; a team can be more restrictive, never less.
- **Field binding is optional, never required.** Backyard and non-enabled parks work with no field; binding only *adds* signage, sponsors, and fence-QR discovery.
- **Either layer is optional, gracefully.** Broadcast ends but scoring continues → stats-only. Scoring stops but video rolls → scorebug holds its last state.
- **Per-camera delay.** Each angle can have its own latency; delay calibration is per-broadcast, synced to whichever feed the viewer is watching.

Same primitives whether a parent films their kid's backyard game (no field, one team-game, pairing code) or a two-team tournament game on an enabled field (matchup on the field, two books, fence QR does the rest). Build it once; both models inherit it.

---

## The market reality (know your competition)

GameChanger is already moving on facility streaming — but the **hardware-heavy** way:

- **Dec 2025 — GameChanger × Pixellot:** QR-enabled, permanent **fixed cameras** at recreational fields; a parent scans to activate; the stream plays **inside the GameChanger app**. A 32-league pilot doubled live-stream viewership and team followership.
- **Mar 2026:** preview of multi-angle, computer-vision auto-switching fixed cameras (no operator).
- **Mar 2026:** a ~$449 co-branded GoPro streaming bundle sold to families through DICK'S.

So the category is real and validated — which is good. But their approach rests on three structural commitments — **fixed-camera hardware, the GameChanger app, and family-paid subscriptions** — and each one is an opening.

---

## The wedge: the asset-light triangle

Bandbox wins on the flank by inverting all three:

1. **No-install capture.** The crowd's phones are the cameras, so any field lights up *today*. Industry data: only ~15% of facilities have any fixed camera, and rec fields are effectively 0%, because the install/infrastructure build-out is genuinely hard across the range of field variables. The hardware approach can't reach the long tail; you can.
2. **No-app viewing.** Just a URL — scan, watch in the browser. For a casual attendee or a distant relative, tapping a link beats downloading an app (and dodging a paywall) every time. GameChanger's facility streams funnel into their app, and they can't drop it — it's their engagement and subscription engine.
3. **Family-free, sponsor-funded.** Facilities and local sponsors pay; families never do. Tasteful flat sponsor panels on the vintage scoreboard — an aesthetic *built* for this. The pitch to a league becomes "this earns your boosters money and costs your families nothing," not "make your families subscribe."

**Why the incumbent resists following:** they sell hardware, monetize app engagement and family subscriptions, and are owned by a retailer that wants to move camera bundles. Going asset-light, app-free, and family-free would cannibalize their core. That's your durable space.

---

## Business model

- **Core (team/family, direct):** the primary product sold to teams/families — likely free to broadcast and watch, with a low-cost team or family subscription for the richer features (stats depth, AI commentary, follow-my-kid, keepsakes). This is the base business and the proof point.
- **Channel (facility/league):** facility / league / tournament subscription (per-field or per-facility, seasonal) — the same product sold to the venue as a broadcast amenity.
- **Offset:** local sponsorships shown flat on the scoreboard — can make the facility deal free or net-positive for the buyer.
- **Upsell (B2C):** family premium — follow-my-kid + on-deck pings, a recruiting-grade exportable record, vintage keepsake scorecards and season "baseball cards." The facility channel delivers these users for free; premium monetizes the motivated ones.

---

## What makes this hard (the honest part)

- **Coverage isn't guaranteed.** Crowdsourced supply is exactly what fixed cameras solve. If no parent films, the amenity didn't deliver. Mitigate: a designated "anchor" broadcaster per team; let a facility optionally drop in one cheap fixed anchor cam on its main field; sell it as "enables broadcasting," not "guarantees every game."
- **Quality gap.** Phone angles vs Pixellot's automated pro production. The bet: "good enough, free, on every field" beats "great, on 15% of fields."
- **Privacy / child-safety is gating, not optional.** A facility-branded, scan-to-watch-kids system is a liability minefield. League-set access tiers (public / team-only / private), consent, and live-only limited info are table stakes — and a differentiator if done well.
- **Contested category, funded incumbent.** You'd be flanking a DICK'S-backed player actively building here. The ambition isn't "beat GameChanger" — it's own the asset-light / no-app / free niche, win locally or regionally, or build something a larger player would want to acquire.
- **B2B reality.** Parks departments and leagues move slowly; this is a real company (sales, support, signage, policy, possibly some hardware), not a weekend build.

---

## Privacy & consent model

The goal is a system that actually broadcasts. Over-restrict it — everything locked to roster-gated private by default — and you've built a broadcasting product that broadcasts nothing. So calibrate to *light-touch*, and benchmark to how the market leader actually operates.

**How GameChanger handles it (the calibration reference):** streams are broadcastable by default. The streamer picks the audience per game — "family & players only" or open to "anyone with the link" — confirmed family/players can stream by default, only the permanent *archive* is gated (behind a subscription), and consent/control responsibility is pushed to the Team Admin / Organization, with the service framed as general-audience and honoring removal requests. The biggest, best-resourced player in the space defaults to *open with a one-tap lockdown option*, not the reverse. Match that posture.

**Push consent upstream, three layers (the league does the consenting; you make it easy and provable):**

1. **Contractual** — the facility/league onboarding agreement carries a rep-and-warranty that they've obtained all necessary media releases from participants/guardians, a covenant to display the consent signage and include release language in registration and parent comms, a **certification** that they've done so, and an **indemnification** for claims arising from their failure.
2. **Operational** — don't just require it, *supply* it: ship the consent signage as part of the QR printout, provide drop-in release language for their registration forms and parent emails, and capture the certification as a **timestamped, logged audit record** (who certified, when, which season). The audit trail — not the contract sentence — is what makes the indemnity defensible later.
3. **Product** — light controls that back the policy without killing reach: a per-game **audience toggle** (link-shareable by default, one tap to "team/family only"), **live-only with no public archive** unless explicitly enabled (cheap protection that doesn't hurt live broadcastability), and an easy **takedown / kill** path. Default to broadcastable; make lockdown one tap away.

### Opt-out = de-identification, not de-filming

The move that keeps an opt-out from blowing up the whole model: **separate appearance from identification.** A parent's real concern is almost never "keep my kid off camera" — a wide field shot of a public game is already covered by the league's media release and the fence notice. It's "don't *name, profile, stat-track, or make my kid permanently findable*." All of that lives in the data layer, not the video, so an opt-out is a database flag, not a video problem. (It's also exactly the lever the market leader uses: GameChanger's remedy for a minor is to *anonymize*, not delete the footage.)

**Default names down, opt up — system-wide:**
- **Public default = first name + last initial** on every public-facing surface. The common worry ("full name permanently findable") simply never happens unless someone turns it on.
- **Full last names are a league/team opt-*in*,** enabled only by the party that collected and certified consent — never by you, never unilaterally by one parent. Turning it on is an affirmative act tied to the certification.
- **Per-family downgrade is always available:** even when a team enables full names, a family can pull their kid back to first-name-last-initial, number-only, or no individual stat line. Defaults cascade; individuals can always be *more* private, never less.
- **A number-only / no-stat-line / no-featuring tier sits underneath** for genuine must-not-be-identified cases (first-initial-last-initial isn't truly anonymous on a 12-kid roster).

**Appearing at all is a league policy decision, not an engineering one.** For the rare family that must not appear even incidentally (custody, foster, safety), don't promise real-time blurring — it's error-prone, and one miss is a breach. The remedy is upstream: the league flags the player do-not-stream, doesn't stream that field, or uses the kill switch. They have the relationship and the knowledge; you provide the flag and the off switch.

**Build requirement — one display-name function.** Name rendering must run through a single shared `displayName(player, context)` that *every* surface calls — scorebug, box score, play-by-play, AI commentary audio (it must not *say* a name the feed only shows as an initial), highlight tags, share links, exports. Centralize it and leaks become impossible by construction; scatter it and you'll expose a full name in the one place you forgot.

**This costs broadcastability nothing.** The game still streams in full; players are simply un-named by default. A real, defensible opt-out *and* a system that actually broadcasts — never in tension.

**Don't over-trust the indemnity — three caveats:**
- An indemnity shifts who pays *if you win the allocation fight*, and only as far as the indemnifier can pay; a small league or a public parks department may be judgment-proof or immune. Carry your own **liability insurance** (media/tech E&O + general liability) regardless.
- Some consents don't delegate cleanly — minors' image/biometric data is increasingly regulated (state biometric and child-privacy laws; COPPA if under-13s interact with the app directly). Get a **one-time legal review** from a youth-sports/privacy attorney before the first facility signs.
- Fence signage is *notice*, not *consent*. The registration-time release (where a guardian actively agrees) is the legal spine; signage handles incidental capture and expectations.

**The upside:** every youth league already runs photo/media releases — you're slotting into an existing habit, not inventing one. Packaged well ("we make your league's media-consent compliance turnkey — signage and form language included"), this reads to a nervous parks director as a *feature*, not a hurdle.

### Content moderation & takedown (basic protections)

Letting the crowd contribute video means a content-moderation duty. Keep it basic — prevent, detect, respond — and scope it as a **launch-gate for the field channel, not the team product** (authenticated family filming their own kids is low-risk; the open field/tournament channel, where strangers can film, is where this matters).

- **Prevent — auth to broadcast.** Watching stays open; *contributing video* requires an authenticated account, and on a field, a tie to the matchup (confirmed member, or code/approval from the field's account). Abuse loves anonymity; this one rule removes most of it.
- **Detect — make humans fast.** A prominent **"Report"** on every viewer and a **one-tap kill** for whoever has authority over the matchup (scorer, team admin, field owner). Motivated parents are your best moderators. Add an automated nudity/violence/CSAM classifier on incoming frames as backup when you can — helpful and shows reasonable measures, but imperfect, so don't rely on it alone.
- **Respond — kill, don't queue.** A report or classifier hit **cuts that broadcast immediately** (not "flag for review"). Because broadcasts attach to the matchup, killing one camera leaves other angles and the scorebug running. Auto-suspend that broadcaster pending review; default live-only/no-archive means little persists to clean up.

**Two obligations not to skip (lawyer territory, handle before the field channel goes live):**
- **CSAM is a legal pipeline, not moderation.** If the platform ever hosts child sexual abuse material, U.S. law requires reporting to NCMEC plus evidence preservation — use established detection/hash-matching vendors, don't roll your own.
- **Safe harbor is earned.** Section 230 / DMCA protection for user content generally depends on *having and following* a real notice-and-takedown process, prohibiting terms, and a report path — so the above is also what keeps you a protected host.

Honest note: this is light for the team product, but a real (staffed, get-a-lawyer) function for the open field channel — another reason to launch the low-risk team product first. And it's the cost of the wedge itself: fixed cameras can only see the field, but *anyone's phone* can see anything, so the moderation exposure is the flip side of the asset-light advantage.

---

## The smallest pilot — "one field, one weekend"

Prove the whole thesis cheaply, on top of the personal app:

1. Add two things to v1: a **per-field static QR** that resolves to "the game on this field right now," and a **scan landing page** with two buttons — **Watch** and **Broadcast**.
2. Pick one local complex or one tournament. Print Bandbox QR signage for a single field. Recruit 2–3 parents as broadcasters.
3. Run one weekend: every game on that field is watchable by a link, multi-angle when 2+ phones are live, stats if anyone's scoring.
4. **Success looks like:** distant families actually tuned in, one sponsor's name was on the board, and the facility says *"put this on all our fields."* That sentence is the entire business case — and it sells far better than any deck.

---

## Scope discipline

This is a thesis to validate later, not a spec. It must not leak into v1. Get streaming-plus-stats rock-solid for your own kids first — the working demo is what earns the right to have this conversation at all.
