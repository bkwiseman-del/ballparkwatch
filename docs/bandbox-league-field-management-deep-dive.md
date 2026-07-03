# Bandbox — League & Field Management: Deep Dive

> Companion to `bandbox-competitive-and-ip-memo.md`. Research gathered July 2026 from public sources (vendor sites, Capterra/G2/Software Advice/GetApp/TrustRadius reviews, BBB complaints, app-store reviews, alternatives round-ups). Market facts move fast — treat the competitor specifics as a snapshot. Not legal advice.

---

## 0. The thesis in one paragraph

Don't build a registration/payments platform — that market is mature, consolidated, and defended by a compliance-and-money moat we don't want to build. **Do** build the layer we're already 70% of the way to owning: the **game, field, and streaming operations layer**, wrapped in enough scheduling/communication/registration-lite to be the reason a league or field says yes. Then let it distribute Bandbox's real product — the matchup, the field cams, the streaming — top-down to every team and family at once. The management tooling is the *door*; streaming is the *payload*. And the whole space is uniquely shoppable right now, because the incumbent our local field uses is being shut off.

---

## 1. Why the timing is unusually good

**Sports Connect is being sunset in 2027.** Its parent, Stack Sports, merged with PlayMetrics in June 2025 (Genstar Capital is now majority owner), and the combined company is steering Sports Connect and its Association Platform customers onto PlayMetrics. Governing bodies are already announcing the move — AYSO and multiple state soccer associations have published 2026–2027 transition notices.

Why this matters for us:

- **15,000+ organizations are being forced to re-evaluate their entire stack.** Switching costs normally make these platforms sticky; a forced migration temporarily removes that stickiness for everyone at once.
- **The competitors smell blood.** Jersey Watch, TeamLinkt, TeamSnap, LeagueApps, SportsEngine, and TeamSideline are all running "Sports Connect alternatives" and "PlayMetrics alternatives" campaigns right now. The re-shopping is real and public.
- **Integrations are getting torn up and rewired.** GameChanger currently imports rosters/schedules *from Sports Connect*. When Sports Connect dies, those pipes get rebuilt toward PlayMetrics — which means the integration landscape is briefly fluid, and a well-behaved newcomer can slot in.
- **The successor is soccer-first.** PlayMetrics was purpose-built for youth *soccer* clubs. Baseball/softball rec leagues are about to be migrated onto a soccer operating system. That's a wedge: a baseball-native operations layer, from people who obviously speak baseball, lands differently than a soccer platform with a baseball mode.

The window isn't forever — it roughly tracks the 2026–2027 migration cycle. That argues for having *something* credible in front of leagues during that window, even if narrow.

---

## 2. Who we're actually up against

Five archetypes. They are not all the same competitor.

| Platform | What it is | Core strength | Where it's soft |
|---|---|---|---|
| **PlayMetrics** | The successor everyone's being pushed to. Club/league OS. | Genuinely modern; strong **drag-and-drop field planning** with real-time field usage + automated closure alerts; loved by soccer clubs. | Soccer-first; **opaque quote-based pricing**; high learning curve for volunteers; no built-in club finances; support reportedly slipped post-merger. |
| **SportsEngine** (NBC) | The big incumbent. Registration + websites + SRM. | Governing-body ties (USA Hockey etc.); all-in-one; broad. | *Widely disliked in reviews.* Buggy scheduling, ads in a paid product, slow support, clunky admin, divorced-parent/multi-email failures, forced migrations. |
| **TeamSnap** | Team-and-communication first, league layer bolted on. | Ubiquitous; parents already know it; good availability/RSVP. | **Trustpilot ~1.2★**; forced "TeamSnap One" migration; ads in paid tiers; pricing creep; web/mobile feature gaps; no real scoring. |
| **Jersey Watch** | The volunteer-friendly simple one. | Easy, low learning curve, transparent pricing, responsive support, website+marketing; ~2,800 orgs. | Lighter on deep competition-ops and advanced scheduling; less muscle for big/complex orgs. |
| **LeagueApps** | The premium, powerful one. | Deep, flexible, serious org-grade tooling. | "Bring your budget"; heavier and pricier than a volunteer board wants. |
| **GameChanger — Leagues & Tournaments** | The competition-ops incumbent (not registration). | **Free**; org of 2–100 teams; auto-standings (This League / Overall); dual scheduling that lands on both teams' calendars; 5-day pitch-count reports; TBD/placeholder bracket teams; imports from Sports Connect. Feeds their scoring+streaming. | No registration/payments/field-facility layer; single-stream single-team; app-locked; asset-light (no field cameras of their own). |
| *(also-rans)* | TeamLinkt (free/freemium), TeamSideline, Crossbar (now PlayMetrics-owned), Uplifter, LeagueLineup | Various | Various |

**The important read:** the market splits into two jobs that are usually sold together but are actually separable —

1. **Business back-office:** registration, payments, refunds, websites, governing-body compliance, background checks, insurance. (SportsEngine / PlayMetrics / Sports Connect / TeamSnap / LeagueApps / Jersey Watch.)
2. **Competition operations:** schedules, standings, field assignments, game-day, results, streaming. (GameChanger owns the light version of this and feeds it into scoring/streaming; the registration platforms treat it as a secondary module.)

We win in #2 and rent #1's hardest parts. GameChanger proved #2 is a viable standalone layer that *sits on top of* whoever does registration. That's exactly the seat we take — except we bring the field cameras and the dual-scoreboard matchup they don't have.

---

## 3. What users are actually complaining about (the gold)

This is where the strategy comes from. Across hundreds of reviews, the same wounds repeat — and almost none of them are "missing features." They're **trust, reliability, money, and respect-for-the-volunteer** wounds. Each is a design principle for us.

**A. "It's buggy and it drops things at the worst time."**
Buggy scheduling, incorrect standings that stay broken for weeks, apps that force-close and delete a message mid-compose, constant updates that slow the app down. In this category *reliability is the product*, and everyone is failing it. → **Principle: boringly reliable beats feature-rich. "It just works and it stays up" is a winning, differentiated promise here — same as on the streaming side.**

**B. "There are ADS in the thing I'm paying for."**
TeamSnap and SportsEngine both catch heavy flak for advertising inside paid products, plus pushed add-ons (insurance, "reg saver") that parents feel tricked by. → **Principle: no ads, ever, and no dark-pattern upsells. Say it out loud. It's a values wedge and it's cheap to hold. (Consistent with Anthropic-style "this is a space to think," not an ad surface.)**

**C. "Support disappears when I need it."**
Days-to-weeks response times, canceled support meetings, chat that gets closed without an answer, reps lost after acquisitions. Volunteers run these leagues at night and on weekends. → **Principle: fast, human, off-hours support is a moat the big PE-owned platforms structurally struggle with. Even good self-serve + genuinely responsive help beats them.**

**D. "It's too complicated for a volunteer who turns over every year."**
"We use 10% of the features." "I had to hire someone to set up the website." Steep admin learning curves; every season a new volunteer relearns it. → **Principle: setup has to be survivable by a brand-new volunteer in one sitting. Ruthless defaults, baseball-native templates, near-zero configuration. Simplicity is a feature the incumbents have priced themselves out of.**

**E. "The parent/family model is broken."**
The single most repeated *specific* complaint: divorced/separated parents can't both get their own login and both get league notifications; only the registering parent has real access; secondary emails silently don't receive admin messages; guardians get kid info but not league info. This breaks communication for a large fraction of modern families. → **Principle: multi-guardian, multi-household as a first-class data model from day one. Every child can have N adults, each with their own login and full notifications. This is embarrassingly overdue and nobody's nailed it.**

**F. "Web and mobile don't match."**
Constantly: a thing you can do on the website you can't do in the app, and vice-versa. Admins get stranded on the wrong surface. → **Principle: one code path, true parity. Our PWA approach helps here — one app, everywhere.**

**G. "Fees feel like a money-grab."**
Complaints about high per-registration processing fees, opaque quote-based pricing you can't see without a sales call, and pricing that creeps up yearly. → **Principle: transparent, published, per-seat pricing (same DNA as our streaming pricing). No mandatory sales call to see a number.**

**H. "Communication doesn't actually reach people."**
Delayed chat, notifications that don't fire, emails that don't arrive, so leagues fall back to a *second* app (GroupMe/Band) for messaging — defeating the "all-in-one" pitch. → **Principle: communication that provably lands (delivery receipts, fallbacks, and a plain calendar-feed families can subscribe to) is a real differentiator.**

The pattern: **the incumbents lost the volunteers' and families' trust on reliability, honesty, and simplicity — not on feature count.** That's the opening, and it's the same opening as on the streaming side.

---

## 4. Table stakes — what we must have to be taken seriously

If we show up to a league board without these, we're not a real option. None of them is exotic; the trick is doing them *simply and reliably*.

**Season & structure**
- Organization → divisions/age groups (10U, 12U…) → teams → rosters.
- Season setup with a baseball-native template (typical division names, roster sizes, game lengths) so a volunteer starts 80% done.

**Scheduling**
- Build a season schedule; games auto-appear on both teams' calendars (GameChanger already sets this bar — match it).
- **Field/diamond assignment** with conflict detection (no two games on Field 3 at once).
- One-tap **reschedule/rainout** that re-slots a game into open field capacity and notifies everyone affected.
- Practices and non-game events, not just games.
- Subscribable calendar feed (iCal/Google) filtered to *just games* for extended family — a specifically requested, specifically missing feature elsewhere.

**Standings & results**
- Auto-standings from completed games (This-League vs Overall, like GC).
- Because we already score the game, standings are a *byproduct*, not a separate data-entry chore.

**Communication**
- Org-wide, division-wide, and team-wide messaging that provably delivers (email + push + text fallback).
- Multi-guardian households (see 3E) — non-negotiable.

**Registration-lite** *(not full back-office — see §6 for the hard line)*
- Player signup + roster intake + waivers/forms.
- Fee collection via **Stripe Connect** (Stripe carries PCI + money movement; we own UX + data).
- Basic discounts/coupons, installment plans, refunds.

**Baseball-native compliance surfacing**
- Pitch-count tracking + 5-day report (GC bar) — trivial for us since we already score pitches.
- Surface (don't reinvent) governing-body requirements; integrate with Little League etc. rather than becoming the system of record.

**Admin sanity**
- One-sitting setup for a new volunteer; true web/mobile parity; no ads; transparent published pricing; fast human support.

---

## 5. The wedge — what we can do that they structurally can't

Everything above is *entry*. This is *why we win*. Each item leans on infrastructure we've already designed, so it's cheaper for us to build than for them to copy.

**1. The field is a real object, with cameras on it.**
To the registration platforms a field is a text string. To us it's a first-class entity with a **permanent QR code and field cameras** already in the architecture. So "field management" for us isn't just a scheduling calendar — it's *the physical field, its live feed, and its schedule as one thing*. A league admin assigns 12U-B to Field 4 at 10am, and that assignment **is** the thing that binds the field cam, the matchup, and the stream. Nobody else can offer that because nobody else has the field layer.

**2. Land the league → every game is already streamable.**
When a league adopts us for operations, the field QR + field cams get installed once, and **every team and every family is onboarded top-down in a single motion**. That's the distribution unlock: instead of selling Bandbox team-by-team, one league "yes" lights up dozens of teams and hundreds of families — and the streaming/matchup product (our actual money and delight) rides in on the back of the boring scheduling tool.

**3. Standings, pitch counts, and results are free byproducts.**
Because we already score the game play-by-play, the league's standings, results, and pitch-count compliance reports generate themselves. For the incumbents these are separate data-entry surfaces (and a source of the "standings are wrong for weeks" complaints). For us they fall out of scoring we're already doing.

**4. Rainout reschedule is a spatial problem we can actually see.**
We know every field, every field's schedule, and every game's field-cam binding. A rainout becomes: re-slot into visible open field capacity, re-bind the cameras, fire notifications, done. The registration platforms can move a calendar entry; they can't re-wire a physical field's live feed because they never had it.

**5. The matchup model already solves league scheduling primitives.**
Ghost opponents = TBD/placeholder teams for brackets, but *live and joinable* instead of dead strings. Dual scheduling onto both calendars = our matchup with a schedule wrapper. We designed the hard part (two independent team-seats sharing one game) for streaming; pointing it at a league schedule is mostly a new view, not a new system.

**6. Baseball-native, not soccer-with-a-baseball-mode.**
The successor platform is soccer-first. We can speak diamonds, innings, pitch counts, batting orders, and mercy rules natively, with defaults that make a Little League volunteer feel immediately understood.

---

## 6. How we do it *better and easier* (concrete mechanisms)

Brandon's actual question — not "what features," but "how do we make this so much better and easier." The answers are mechanisms, not feature lists.

**Easier for the league admin:**
- **One-sitting setup.** A baseball season wizard with real defaults (divisions, roster sizes, game length, pitch-count rules by age). A new volunteer finishes in an evening, not a week. This directly counters the #1 volunteer complaint.
- **The schedule builds most of itself.** Give it teams, fields, dates, and blackout days; it proposes a conflict-free schedule you tweak by drag-and-drop. PlayMetrics has drag-and-drop field planning — we match the UX and beat it by tying it to the live field/camera layer.
- **Reschedule in two taps, cascade handled.** The thing that eats a volunteer's Saturday morning becomes a two-tap re-slot with automatic notifications.

**Easier for families:**
- **Multi-guardian by default.** Every kid → many adults, each with a real login and full notifications. Fixes the most-cited family failure in the entire category.
- **A calendar feed that just works.** Subscribe once; games flow into your phone calendar; share a games-only feed with grandparents. And those same games are one tap from the live stream.
- **No app maze.** One PWA, web/mobile parity, no "you can only do that on the website."

**Easier to trust:**
- **No ads. Ever. Published pricing. No mandatory sales call.** State it as policy. It's a direct rebuke of the two loudest money complaints (TeamSnap/SportsEngine ads; opaque quote-based pricing).
- **Reliability as the headline.** "It stays up" — the same promise as the streaming product — is *the* unmet need in league software too. Boring uptime is a marketing position here.
- **Human, off-hours support.** The PE-owned incumbents are structurally slow here; a responsive founder-led support experience is a moat early and a differentiator later.

**Better because it's connected:**
- The single biggest "better": **operations and streaming are one system, so every scheduled game is already a broadcast.** No competitor can say "your league schedule and your live games and your field cameras are the same object." That's the whole pitch in one sentence.

---

## 7. The hard line — what we deliberately do NOT build

Holding this line is what keeps the project from quietly turning into a fintech/compliance company.

- **Not a payment processor.** Wrap Stripe Connect; let Stripe own PCI, money movement, chargebacks, payouts, tax. We own the checkout UX and the data.
- **Not the governing-body compliance system of record.** Background checks, insurance products, eligibility/roster certification tied to Little League/AYSO/USSSA — *integrate with*, don't rebuild. This is the genuine moat those platforms have and the lowest-leverage thing for us to reproduce early. Reproducing it is a multi-year slog with real liability; renting it is a weekend.
- **Not full club-finance/accounting.** Even PlayMetrics gets dinged for lacking this and people bolt on other tools. Not our fight.
- **Not soccer/multi-sport at launch.** Baseball/softball native is the wedge. Breadth dilutes it.

Segment split (from the memo): for **NGB-bound rec leagues** (our local field), be registration-lite + ops + streaming and *integrate* the compliance/registration system they must use. For **independent tournaments and travel orgs** (light compliance burden, love the streaming/recruiting story), we can credibly own the fuller stack.

---

## 8. Honest risks

- **The successor is good.** PlayMetrics is genuinely liked and well-funded (Genstar). We don't beat it on back-office breadth; we beat it on baseball-nativeness, the field/streaming tie-in, price transparency, and reliability. Stay in our lane.
- **This is a different sale.** Selling to a volunteer board is B2B, seasonal, slow, relationship-driven, and trust-gated. It's not the parent/team motion. Decide deliberately how much energy goes here vs. the team product, and time the pitch to the migration window.
- **Support is a real cost.** "Fast human support" is a promise that costs money and attention as we scale. Design self-serve to keep the human load sane.
- **Reliability is a promise we then have to keep** — on the ops layer as well as streaming. The differentiator only works if it's true.
- **Integration dependence.** Being the layer on top of PlayMetrics/Little League means their API decisions constrain us. Acceptable, but real.

---

## 9. Suggested phasing

**Phase 0 — our own field (validation).** Run one real season for the local field/league as operations + streaming: divisions, schedule, field assignment, standings, multi-guardian comms, streaming on top. Prove the "one league yes lights up everyone" motion on home turf.

**Phase 1 — the credible minimum for an outside league.** Season wizard + auto-scheduling with field-conflict detection + rainout re-slot + auto-standings + multi-guardian messaging + registration-lite via Stripe Connect + pitch-count reports. Integrate (don't rebuild) whatever registration/compliance system they're required to keep.

**Phase 2 — the wedge made obvious.** Field-cam binding to the schedule, every scheduled game one-tap live, tournament/bracket mode (ghost opponents as live TBD seats), facility sponsor/policy packaging.

**Phase 3 — expand by segment.** Independent tournaments/travel orgs on the fuller stack; deeper governing-body integrations for rec leagues.

---

## 10. One-line positioning

**For the incumbents:** "your registration platform, plus a scoreboard app you have to import into."
**For Bandbox:** "run your league's teams, schedules, and fields — and every game is already live, on the field it's played on, for the families who can't be there." One object. One system. No ads. Stays up.
