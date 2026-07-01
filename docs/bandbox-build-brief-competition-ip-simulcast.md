# Bandbox — Build Considerations Brief: Competition, IP & Simulcast

> Handoff for Claude Code. Distilled from a planning session. These are **constraints and considerations to bake into the architecture** — not new v1 feature commitments unless labeled. Companion to the build plan, design brief, vision/market-wedge doc, and competitive/IP memo. The IP section is research, **not legal advice**.

---

## 1. Competitive context — what to be, what not to be

**Table stakes (competitors already ship these — do NOT treat as differentiators):** free streaming, no-app browser viewing, RTMP-camera support, burned-in scoreboard overlay, auto-highlights, highlight texts, recruiting export, sponsor logos.

**Closest competitor — SidelineHD:** free stream to Facebook/YouTube/its own app, shareable-link scoring, iScore integration, burned-in overlay, auto-clips, 2-min recap. **Documented weakness: reliability** (streams drop, scoring white-screens, "new bugs weekly").

**Incumbent — GameChanger (DICK'S):** app-locked, family-paid; adding Pixellot fixed-camera QR streaming + multi-angle AI at fields.

**Bandbox's real differentiation to protect in code (build these as first-class, not add-ons):**
- **field → matchup → team-games** model → home/away dual scoreboards over one shared video
- **multi-angle** (multiple broadcasts per matchup)
- **AI voice commentary booth**
- **reliability** — "it just stays up" is the winnable gap; prioritize stream/scoring robustness, reconnect logic, and graceful failure over feature count
- vintage identity; field/facility infrastructure

---

## 2. IP / patent constraints (design-around guidance, not legal advice)

**Active GameChanger patents:** US 8,731,458 (expires 2030-03-11) and US 9,393,485 (expires 2029-06-02). Both independent claims require BOTH of: (a) a graphical baseball-field diagram where the user **taps the location a ball was hit**, AND (b) a menu of play/pitch outcomes.

**Precise distinction (important):** spray charts and hit-location data are **NOT** what the claim covers — charting where balls are hit is old, widespread prior art, and is fine as an output/analytics feature. What the independent claims require is a specific **input gesture**: a graphical baseball-field diagram where the operator indicates where a ball was hit **by contacting the corresponding location on that field graphic**, combined with an outcome menu. Only that input-gesture-plus-menu combination is claimed.

**→ Build rule (design-around): produce full hit-location data and best-in-class spray charts, but capture location via a NON-field-diagram input — a fielder + trajectory model, not a coordinate tap on a rendered field.** Recommended flow: operator picks the outcome (buttons), then indicates where the ball went by tapping the **fielder** it went to/through (positions known from the lineup) + a quick **hit-type** (grounder/liner/fly) + **depth** (infield/shallow/gap/warning-track/gone) + optional **direction** (pull/center/oppo). Compute approximate field coordinates from fielder + trajectory + depth → render spray charts freely. Later, the vision-assist track can refine coordinates from video (more precise than manual tapping, still no claimed gesture).

**This is exactly how competitors avoid it:** iScore records location by dragging the **fielder's glove** to where the ball was hit (fielder-centric, not "tap the field diagram"); SidelineHD uses outcome buttons + "tag the fielder who made the play" and does no field-tap at all. Both produce spray charts. Fielder-based entry is the proven design-around.

**Do NOT** implement the literal "operator contacts a spot on a rendered baseball-field diagram to record hit location, in the primary scoring flow alongside an outcome menu" — that specific combination is the claim. If a future design truly wants literal tap-on-the-field entry, get a freedom-to-operate opinion first (the patents are active to 2029/2030). Note: a granted patent isn't necessarily valid — this one may be weak on obviousness — but don't rely on that without counsel; route around it instead.

**Newer GC filings — avoid mirroring their specific methods; keep implementations generic & independent; flag for FTO before commercializing:**
- **US 12,496,524** "automatic media generation for game sessions" — auto-recap/highlights customized from event data + participant traits → be cautious building auto-recap/auto-highlights.
- **"dynamic video generation"** — computer-vision: detect players → compute action location → auto-zoom → be cautious with any CV auto-framing on field cams.

**Litigation:** GC has never enforced patents (only one trademark suit, over the name). Practical risk low. Keep timestamped design docs as independent-development evidence.

**No GameChanger API:** GC stats do not leave their platform live. A parent scoring in GameChanger = **video-only in Bandbox** → the viewer must degrade gracefully to a no-scorebug state. Optional post-game CSV import only; do not architect any live dependency on GC data.

---

## 3. Simulcast to third-party platforms (Facebook / YouTube / etc.)

**Strategic frame:** simulcast is a **reach layer, not the destination** — public platforms are top-of-funnel that route viewers back to the Bandbox viewer.

**Three output tiers (design as delivery modes of one game):**
1. **Bandbox viewer (owned surface) — full experience:** scorebug as **HTML overlay** (not burned in), multi-angle, live stats, AI commentary, de-identification, TV casting.
2. **Public simulcast (FB/YT) — lite/reach:** single angle, **burned-in** scorebug, burned-in CTA/QR back to Bandbox.
3. **Stats-only / no video.**

**Scorebug compositing:** overlay (client-side HTML) on the owned viewer; **burn-in** (device- or server-side composite) is required for simulcast because you don't control their player. RTMP is native to FB/YT ingest, so RTMP-camera/server paths simulcast nearly free; the **phone-WebRTC path needs a server restream/transcode hop to RTMP** (e.g., Cloudflare Stream restream).

**Funnel mechanics (build in):**
- Auto-populate the YouTube/Facebook broadcast **title + description** from game data, including a **deep link to that game's Bandbox viewer** (`bandbox.tv/watch/<game>`), not the homepage.
- Burn a small **"full stats + more angles → bandbox.tv" CTA + QR** into the simulcast composite (reaches TV viewers who can't tap a description).

**Audio on simulcast — copyright-critical:**
- **Camera mic OFF on public simulcasts. Simulcast audio = AI commentary + owned/royalty-free crowd-noise SFX only.**
- Why: FB/YT **Content ID auto-flags copyrighted PA/walk-up music** (present at nearly every game) → can mute, block, region-lock, strike, or kill the stream/channel. Sending only synthetic **owned** audio makes matching impossible by construction; also eliminates profanity/conduct-audio risk.
- Crowd SFX must be genuinely license-clean (royalty-free/original). Drive commentary + crowd cues from the **event log** (same source as the scorebug) so audio stays in sync with game state; let ambience fill gaps so there's no dead air.
- **Owned viewer is NOT scanned by Content ID** → offer real field audio OR the synthetic mix, viewer's choice. Real ambience is fine there.

**Competitor context / edge:** No competitor has an automatic fix — the scanning happens on FB/YT, not in the app, so nobody can turn it off. SidelineHD's own support docs hand users a manual checklist: keep the mic away from speakers, mute it during music, and **fill the audio with a play-by-play announcer** — plus after-the-fact YouTube Studio cleanup (mute/cut the flagged section). GameChanger is similar. **Bandbox's edge = ship the announcer.** The AI commentary booth *is* the play-by-play track SidelineHD tells people to arrange manually, so Bandbox makes the safe path the automatic default on the public tier instead of an operator chore. Still surface the YouTube-Studio cleanup path to users streaming to their own channels as a backstop.

**Simulcast privacy:** the public simulcast is the highest-liability surface → apply de-identification/`displayName()` there too; consider defaulting it more restrictively.

---

## Cross-cutting build requirements reinforced tonight

- **Single `displayName(player, context)` function** called by EVERY surface — scorebug, box score, play-by-play, **AI commentary audio**, burned-in overlays, share links, exports. Default public rendering = first-name-last-initial; full names league opt-in; per-family downgrade; number-only tier.
- **Broadcasts attach to the matchup**, with `owner_type [field|matchup]`; **field cameras** are field-owned broadcasts that **promote** into a matchup when it claims the field and **fall back** to a bare field feed otherwise.
- **Delay buffer + kill switch apply to video AND audio**, per-broadcast.
- **Everything optional / degrades gracefully:** no video, no stats, no field, single team, dropped angle — every combination must render intentionally.
- **Moderation (field channel):** auth-to-broadcast (watching open, contributing gated); prominent Report + one-tap kill; cut immediately (don't queue); default live-only/no-archive.
