# Bandbox — Growth Loops & Reliability (Build Considerations)

> Handoff for Claude Code. Two halves: **(A) growth mechanics to build *into* the product** (the product is the salesforce — the founder does not sell door-to-door), and **(B) reliability engineering — the moat.** Companion to the build plan and the competition/IP/simulcast brief.

**Strategic context (why these are the priorities):** founder is a builder, not a seller, so growth must be product-led and founder-light — every human conversation should be *inbound and warm* (parent-pulled, champion-introduced, organizer-wanted), never cold outreach. Beachhead = own field first, get it rock-solid, then the rec/facility flank GameChanger serves worst (~15% of facilities have cameras; rec ≈ 0%). Realistic ambition = defensible niche/regional leader or an acquirable asset, not a national GameChanger-killer. The product being great and reliable *is* the go-to-market.

---

## Part A — Growth loops to build into the product

These are **features**, not marketing tasks — the growth is engineered into the product.

1. **Opponent loop (the core referral engine — unique to the matchup model).** Because broadcasts attach to the matchup, the opposing team's families watch the same video with their own scoreboard — every game is a live demo to the other half of the families. **Build the viewer→claim conversion:** when someone follows the "other" side, prompt "following the other team? claim your team — it's free." Single-team competitors (GameChanger, SidelineHD) structurally can't do this. Design it to fire every matchup.

2. **Parent-pull facility demand (replaces founder cold-selling).** A **"Request Bandbox at your field"** control that tallies interested parents per field/complex; when it crosses a threshold, generate a warm inbound case ("37 families here already use this — want the official field QR?"). Turns the facility conversation from founder-push into league-pull driven by its own parents.

3. **Sponsor-selling tools for boosters (turns volunteers into the salesforce).** Let a team/booster parent sell and manage local sponsor logos on the stream as a **fundraiser** — self-serve sponsor upload/management (up to N logos), with revenue attribution. Booster parents deploy, promote, and evangelize Bandbox for *their own* financial reason; the founder never makes a sponsor call.

4. **Shareable branded keepsakes (the content is the marketing).** Auto-recap, highlight clips, and vintage "season cards" must be built for **one-tap sharing** to social feeds and group chats, and be **inherently branded** (vintage look + bandbox.tv mark). A proud grandparent sharing a beautiful clip is free, perfectly-targeted reach. The aesthetic is load-bearing here — make outputs delightful enough to share.

5. **Viewer→user funnel (already specced in the simulcast brief).** No-app link + burned-in CTA/QR on public simulcasts route viewers to the owned Bandbox viewer.

6. **Champion perks (per-cluster evangelists).** A mechanism to reward local champions — free premium, early features, a cut of sponsor revenue, "official Bandbox complex" badge/status. The community member sells to the community, not the founder.

---

## Part B — Reliability = the moat (engineering)

**The product is the salesforce; every dropped stream is a lost salesperson.** Reliability is the #1 build investment, not a feature bolted on later.

**Positioning to keep it honest and achievable: "never dies, not never drops."** You cannot guarantee cell signal. You *can* guarantee that when signal wobbles, the stream degrades instead of ending, the scoreboard keeps working, the recording survives, another angle covers the gap, and on enabled fields a wired anchor feed isn't fighting the cell network at all.

### Why competitors drop (diagnose before fixing)

- **Physics (unavoidable):** youth fields have weak/congested cell signal; **upload** bandwidth (the scarce direction for streaming) craters as the stands fill and hundreds of phones fight one tower. No app manufactures signal. Don't promise "never drops."
- **Software (preventable — this is the opportunity):** most review-pain isn't the blip, it's the app **failing to survive** the blip — the stream *ends*, scoring *white-screens*, stats *reset*, the recording is *lost*. Graceful degradation vs. catastrophic failure is the entire wedge, and it's builder work.

### Engineering requirements (the counters)

1. **Treat disconnects as routine, not fatal.** The capture client must assume the connection *will* drop: aggressive auto-reconnect, buffer through the gap, resume automatically. A 10-second dip becomes a 10-second quality dip, not a dead stream.
2. **Stats/video orthogonality (already core — protect it).** The event-sourced stats spine is independent of video: a video failure cannot kill the scoreboard, and a scoring glitch cannot kill the video. Failures **isolate instead of cascade** — this is exactly the architecture competitors lack when their scoring white-screens.
3. **Adaptive bitrate from day one.** When upload bandwidth drops, auto-downgrade resolution and **keep going** rather than stalling trying to push HD through a straw. Degrade to low-quality-but-alive. (SidelineHD ships an HEVC low-bandwidth mode; this is table stakes, not optional.)
4. **Local-first recording.** The capture device records locally **regardless of stream health** and uploads later. The live feed can die without losing the game footage — kills the "you don't get the full video" complaint.
5. **Multi-angle failover.** Because broadcasts attach to the matchup, if one phone drops, another angle keeps the matchup live. Redundancy single-camera products can't offer — surface it as automatic failover in the viewer.
6. **Wired / anchor uplink for facilities (the trump card).** A field cam on **wired internet** (or a dedicated bonded/cellular uplink at the press box) sidesteps the congested-cellular failure mode entirely. The competitors depend almost wholly on a random parent's phone on public cell; the facility model can put a reliable, powered, wired anchor feed on every field. This is *why* Bandbox can credibly be more reliable where it counts.
7. **Delay buffer + kill switch** already apply to video and audio, per-broadcast.

### Discipline

Reliability is not a feature you add; it's a discipline you hold across the whole build. **Test in ugly real conditions** — the dead-signal corner of the worst local field is the test bench, not the desk. This is simultaneously the hardest-to-copy moat and the thing that makes every growth loop work, because a product that stays up is a salesforce that keeps showing up.
