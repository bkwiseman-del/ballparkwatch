# Bandbox — Packaging & Pricing

> Strategy note for the doc set. Companion to the vision/market-wedge and growth docs. Not v1 build scope — this is the tiering/monetization thesis to validate once the product is solid. Cost figures based on Cloudflare Stream pricing as of mid-2026; re-check before committing.

---

## The idea: broadcast-only as the front door

A **broadcast-only** package — stream video to family with no scoring required. This is likely the lowest-friction entry point Bandbox has:

- **Kills the #1 objection in the category** ("I don't want to be a prisoner to the scoring app") by removing scoring entirely. "Point your phone, family watches, done."
- **Additive for GameChanger users** — they keep stats in GC and bolt Bandbox on as a video pipe. Near-zero switching cost.
- **The shallow end of a natural upsell ladder** (below).

**Optional basic scoreboard add-on:** score + balls/strikes/outs only. Trivial to enter, needs none of the tap-the-field mechanics being routed around for IP reasons, and turns flat video into a real broadcast with a live scorebug. Offer it as optional, not default (see "two audiences").

---

## Why viewer-count pricing is the right model (it tracks cost)

On Cloudflare Stream: **ingress and encoding are free, and adaptive-bitrate (multi-resolution HLS) transcoding is included at no extra charge.** You pay for **delivery at ~$1 per 1,000 viewer-minutes**, plus storage (~$0.01/GB/mo) only if recordings are kept. So cost is almost entirely **viewer-minutes** — meaning a per-viewer-count model maps almost perfectly onto actual cost.

**Cost math (2-hour game):**
- 1 viewer, full game ≈ 120 min ≈ **$0.12**
- Free tier @ 5 concurrent viewers ≈ **$0.60/game** worst case
- Paid tier @ 50 concurrent ≈ **$6/game** at full cap — realistically far less (typical youth games draw single-digit to low-double-digit remote viewers)
- Live-only (default, no archive) ≈ **$0 storage**

The viewer cap does **double duty**: it bounds cost *and* enforces privacy. Frame "up to 5" as **"family-sized and private,"** not "crippled free."

**Proposed tiers:**
- **Free:** up to 5 concurrent viewers (family-sized, private).
- **Paid account:** up to 50 concurrent viewers.
- **Add-ons:** more viewers, metered/capped so price tracks cost.
- **High-volume (tournaments):** route to a facility/tournament deal that covers the delivery bill rather than a flat consumer tier.

---

## Two audiences — they want different things

1. **GC-for-stats parents** are *already scoring in GameChanger* and won't double-enter score/B/S/O in Bandbox — and GC has no API, so their scoreboard can't be pulled in. For them, this is honestly **video-only**; the scoreboard add-on is friction they'll skip.
2. **"Just show the score" parents** are who the basic scoreboard **delights** — a broadcast with a scorebug without ever touching a full scoring app. Possibly a larger crowd than expected.

→ Offer the basic scoreboard as **optional**; don't assume the GC crowd wants it.

---

## The honest counterweight: your real competitor is free YouTube Live

A GC parent who "just wants to send video to family for free" can already do that on **YouTube Live for $0, unlimited viewers.** So both the free *and* paid broadcast tiers must justify themselves against free-and-unlimited YouTube. Real answers to build the pitch around:

- **Privacy / access control** — YouTube is public or "unlisted" (anyone with the link). Bandbox offers genuinely **private, invite-only** viewing, which the viewer cap naturally enforces. This is the strongest reason for kids' games.
- **Clean and ad-free** — no pre-roll, no "recommended videos" of random junk beside an 8-year-old's game.
- **One-tap simplicity** — no channel setup, no stream keys.
- **Scoreboard overlay + the Bandbox viewer** — vintage scorebug, casting, later multi-angle — more than raw YouTube video.

**Lead broadcast-only with "private, clean, one-tap, with a scoreboard" — not "free video streaming,"** because you lose the "free video" contest to YouTube and win the "private and simple" one.

---

## The upsell ladder

Broadcast-only → add basic scoreboard → full stats → multi-angle → field/matchup → facility/tournament. Broadcast-only is the **hook**; privacy, the scoreboard, multi-angle, the field/matchup model, the AI booth, and the vintage keepsakes are the **differentiation and retention**.

---

## Cautions

- **The free tier isn't free to you** (~$0.60/game). Either bound it (games/month), treat it as customer-acquisition cost, or ensure it converts.
- **Heavy paid users** (many games × many viewers) can approach a flat annual fee — keep add-ons metered/capped so price tracks cost, and push genuinely high-volume cases (tournaments) toward facility/tournament deals.
- **Don't let broadcast-only become the identity.** Raw streaming is the most commoditized thing Bandbox offers (YouTube and SidelineHD give it away). It gets people in; everything else is why they stay.

---

## Bottom line

Build broadcast-only as **the front door, not the house.** Lowest-friction acquisition wedge, monetizes cleanly on a cost-aligned viewer-count model, and feeds the upsell ladder — as long as it's positioned on privacy and simplicity (vs. free YouTube) rather than on being free video.
