# Bandbox — Competitive Landscape & IP Memo

> Research memo, companion to the vision doc. Not v1 scope. The IP/litigation section is research, **not legal advice** — an attorney's freedom-to-operate opinion is the only thing that clears you. Findings gathered June 2026 from public sources (company sites, app stores, court dockets, patent filings).

---

## Landscape at a glance

The youth-baseball market has fragmented into lanes; most "competitors" overlap only partially with Bandbox.

| Product | What it does | Overlap with Bandbox |
|---|---|---|
| **GameChanger** (DICK'S) | The incumbent: live scoring, streaming, box scores, spray charts, season stats, highlights, team mgmt. Now adding **Pixellot fixed-camera QR streaming** at fields + multi-angle AI (preview). ~3M users/yr, 400K+ teams. | High — but hardware-heavy + app-locked + family-paid |
| **SidelineHD** (Diamond Kinetics) | **Closest competitor.** Free streaming to FB/YouTube/its own app, RTMP cameras, shareable-link scoring, auto-highlights, text highlights, recruiting, sponsor logos. | Very high — see deep-dive |
| **iScore** | Deepest statistical scorekeeping (spray charts, advanced stats). iOS-only, paid, steep learning curve. No parent streaming. | Low (stats depth only) |
| **Rizzler** | Coach-first: in-dugout scoring feeding AI lineups, pitch counts, rule compliance. No parent stream/community. | Low (coach tools) |
| **TeamSnap** | Communication/scheduling/logistics; runs its own ad business. Not real scoring. | Low |
| **Hudl** | Film/analysis + fixed AI-tracking cameras (Focus); serious/HS teams. | Medium (camera/streaming) |
| **Fungo** | Team management (rosters, schedules, lineups, evals) — GameChanger's pre-game gap. | Low |
| **Diamond Kinetics** | Bat-sensor player development; owns SidelineHD; pairs streaming with sensor data. | Low (hardware/dev) |
| **SportsEngine (NBC), Sports Connect, Jersey Watch** | League registration / websites / management. | Low |
| **SocialScoreKeeper** | Privacy-first scorekeeper, subscription-funded, no ads/tracking. | Low |
| **Pixellot / Spiideo / Veo** | Fixed-camera AI auto-production infrastructure (GameChanger's hardware partner is Pixellot). | Medium (field cameras) |

The clean summary: GameChanger owns during/post-game; SidelineHD is the direct free-streaming rival; everyone else owns a different slice (coaching, comms, registration, sensors, cameras).

---

## Deep dive: SidelineHD (study this one closely)

**What it is.** A Diamond Kinetics brand. Multi-sport (baseball, softball, volleyball, basketball, soccer, hockey, lacrosse, water polo). Payments run through Diamond Kinetics.

**Pricing.**
- **Streaming + live viewing: 100% free.** No subscription to stream or watch.
- **sidelinePRO** (individual "Player Manager"): **$5.99/mo or ~$36/yr** — unlocks viewing player clips, player video, and real-time highlight texts.
- **sidelinePRO FOR TEAMS**: **$249.99/yr** promo (reg. $299.99), non-refundable, non-renewing — highlight access for the whole roster for a year, full-game replays, 1080p, up to 30 sponsor logos.

**How it works.**
- **Two devices** (one to stream, one to score) — same constraint as everyone.
- Stream via their app **or** Mevo/GoPro/other **RTMP** camera (paste RTMP URL + key). HEVC low-bandwidth mode for weak internet.
- Streams to **Facebook, YouTube, and its own sidelineLIVE** — **no app download for viewers**.
- **sidelineSCORE**: shareable-link scoreboard controller ("if you can run a scoreboard, you can score"); invite additional scorekeepers; outcome buttons auto-advance runners/outs; tag fielders on outs; auto half-inning at 3 outs; each play generates a clip. **Scoreboard + player-card overlay is burned into the stream.** Historically integrates with **iScore** for full stat tracking.

**Highlights / automation.** Automatic per-play clips; **in-game highlight texts to up to 5 phone numbers** (before the inning ends); weekly highlight compilations; **automatic 2-minute post-game highlight video**; box scores.

**Recruiting.** Player profiles + highlight galleries + **SportsRecruits integration** (push highlights to college coaches). Recruiting is a core angle.

**Fundraising.** Up to **30 sponsor logos** on the stream.

**Hardware.** No proprietary hardware — BYO phone or RTMP camera (Mevo, GoPro, OBSBOT Tail 2, etc.). Publishes gear guides / "what's in my bag" (tripods, battery packs, hotspot, sun-shade towel for overheating, backstop tripod).

**Known weaknesses (from app-store reviews).**
- **Reliability**: recurring complaints of streams dropping ("you don't get full videos"), "new bugs every week," and paid features unusable because the stream drops.
- **Scoring failures**: white-screen "something went wrong" errors that sent a reviewer back to GameChanger.
- **"Claim your player" friction**: parents must claim a player to get a box score — called out as making team stats cumbersome.
- **Paywalled value**: streaming is the free hook; the clips/highlights/replays/recruiting that families actually want sit behind PRO.
- **Owner focus**: Diamond Kinetics is a player-development/sensor company; the strategic center of gravity is recruiting data, not the viewing/facility experience.

---

## What SidelineHD already does that Bandbox had planned (be honest)

These are **table stakes, not differentiators**: no-app browser viewing; free streaming; RTMP-camera support; burned-in scoreboard overlay; automatic highlights + text highlights; post-game recap video; recruiting export; **sponsor-logo fundraising on the stream**. SidelineHD (and largely GameChanger) already ship all of this. A Bandbox *team product* built only on these would be a me-too.

## Bandbox's genuine white space

1. **Field / facility / tournament infrastructure** — SidelineHD is entirely team-and-parent driven: no fixed field cameras, no QR-at-the-venue, no facility account, no persistent field feeds, sponsor logos are team-level not venue-level. The field→matchup→team-games model, field cams, facility consent/sponsor/policy packaging is real, uncontested white space (and the asset-light flank of GameChanger's hardware play).
2. **Matchup with home/away dual scoreboards on one shared video** — SidelineHD is single-team, single-stream.
3. **Multi-angle** — multiple phones → selectable angles. SidelineHD is single-stream.
4. **AI voice commentary booth** (ElevenLabs) — SidelineHD does text highlights and clip compilations, not generated audio play-by-play.
5. **Vintage brand identity** — a felt differentiator in a category of generic modern sports-app looks.
6. **Reliability** — the universal weak point. "It just stays up" is genuinely winnable; nobody has nailed it.

---

## GameChanger litigation finding (the reassuring part)

**Only one lawsuit on record, and it was about the name, not the tech.** In Feb 2021, GameChanger Media (DICK'S subsidiary) sued **Sports Reference LLC** (Baseball-Reference) in the Western District of PA (case 2:21-cv-00128-WSS) — a **trademark** claim after Baseball Reference launched a beta app called "Game Changer," alleging consumer confusion over the "GameChanger" mark (trademark applied 2009, registered 2020). A trademark professor called it "garden variety."

**No patent-enforcement litigation found** — despite GameChanger holding scorekeeping patents since 2014, advertising them in its footer, and watching direct competitors (SidelineHD, iScore, Rizzler) ship overlapping features for years.

**Interpretation.** A decade-plus of holding patents, sitting on DICK'S resources, watching near-identical competitors, and never suing on patents signals a **low patent-enforcement posture** — the patents read as defensive/marketing, not an offensive weapon. Combined with the earlier finding that the core claims are narrow and designable-around (anchored to the tap-the-field hit-location input + outcome menu), the *practical* patent risk looks low.

**Caveats.** Absence of filed suits doesn't rule out private cease-and-desist letters; posture can change, especially against a competitor who gets big in the facility space they're now investing in. The one thing they demonstrably enforce is the **name** — a non-issue for "Bandbox," which is nothing like "GameChanger."

---

## Strategic implications

- The **team product alone is crowded** (SidelineHD + GameChanger own the free-stream/no-app/highlights bundle). Don't position Bandbox as a better version of that — it's a me-too fight.
- **Differentiation lives in the field/facility layer, the matchup dual-scoreboard, multi-angle, the AI voice booth, identity, and reliability.** Concentrate there.
- **Study SidelineHD's scoring UX and reliability failures** as the bar to beat; "it just stays up" plus the facility layer is the wedge.
- **Patent risk is practically low** but confirm with an FTO before commercializing (focus on the newer auto-media / dynamic-video filings, not the old scorekeeping patents), and keep timestamped independent-development records.

---

## Adjacent third-party patents — FTO watchlist (not legal advice)

Beyond GameChanger, a quick scan surfaced these. Grouped by relevance; hand the whole list to a patent attorney for a real freedom-to-operate read.

### Tier 1 — closest to Bandbox's core (check first)

- **Sports Logic Group, LLC — US 9,451,334 / 9,454,993 / 9,861,899** — "System capable of integrating user-entered game event data with corresponding video data." One person records game actions on a touchscreen while another records video; the system associates each game action with the corresponding portion of video and builds an index to jump to matching clips. **This maps onto Bandbox's stats-spine + video-sync + per-play-clip architecture** — the closest hit found. Mitigating context: SidelineHD and others do event→clip association today, so design-arounds likely exist and enforcement appears low, but read these claims first.
- **Ease Live (Evertz) — US 12,556,777** (granted 2026). Synchronizing interactive overlay data (stats, graphics, sponsor graphics) with the video stream so graphics **always match the moment being watched — live, on delay, or paused/resuming.** Uncomfortably close to Bandbox's **delay-buffered scorebug sync**. Brand-new (long life). Caveat: aimed at pro broadcasters; claims may be tied to specific cross-device sync methods that don't read on Bandbox's approach — but the concept overlap warrants a check.

### Tier 2 — field-camera / auto-production ambitions only (not v1 core)

- **Pixellot** — patented AI multi-camera auto-tracking/production (control camera arrays to auto-track, zoom, pan; auto-generate live graphics, highlights, scoreboard integration; dual panoramic/zoomed streams). Relevant **only if Bandbox builds automated CV camera-work** into field cams. Crowd-phone + manual capture doesn't touch it; Pixellot is largely hardware/pro-production. Reinforces: don't build auto-framing CV without an FTO.
- **GameChanger "dynamic video generation"** (from the GC section above) sits in this same bucket — CV detect players → action location → auto-zoom.
- **US 9,555,310** — automated multi-camera streaming service where game-event data drives video production and overlays score/timing/player info. Auto-production territory; relevant only if camera control is automated.

### Tier 3 — tangential / lower concern

- Older family around **"automatically vocalizing sporting event scores"** and second-screen supplemental-content sync — tangential to Bandbox's AI commentary, and notably **old**, which helps: it's prior art suggesting auto/vocalized scores aren't ownable by a newcomer.

### FTO priority order

1. **Sports Logic Group** event-data-to-video patents (closest to core).
2. **Ease Live** overlay-sync patent (closest to the delay-buffered scorebug).
3. **Pixellot + GameChanger dynamic-video** (only if/when building CV auto-framing on field cams).
4. **GameChanger 8,731,458 / 9,393,485** (scorekeeping) — already analyzed; design-around = fielder-based hit-location input, not tap-the-field diagram.
5. **GameChanger US 12,496,524** (auto-media) — before shipping auto-recap/highlights.

**Good sign:** Bandbox's genuinely novel pieces — the field→matchup→team-games structure, crowd-sourced QR pairing, and the de-identification/`displayName()` model — surfaced no adjacent patents. Worth documenting as independent inventions.
