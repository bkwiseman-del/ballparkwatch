# Bandbox — Play Clip Sharing (design)

Status: **planned, not built.** This specs the play-sharing feature and, in particular, how a
branded **stinger intro + lower-third bug + end screen** get baked into a shareable clip. Written
2026-07-11.

## What it is

From a finished (or live) game, a user picks a play (or a highlight the app surfaces) and shares a
short branded video clip to social. The clip is cut from the recorded game video and rendered with:

1. an **alpha stinger** that wipes in to reveal the footage,
2. a **lower-third "bug"** — ideally auto-filled from the game data (score / inning / batter / result),
3. an **end card** (branding + final/score + a "watch on Bandbox" CTA).

All three are composited **server-side, offline** in a single render job. The output is a flat,
opaque **H.264/MP4** any platform accepts — alpha only ever lives in the *source* stinger.

## Why offline compositing (and why alpha is fine here)

The alpha limitation we hit for **live** graphics is a *browser playback* problem — Safari/iOS won't
reliably play VP9-alpha / HEVC-alpha in a `<video>`. Clip rendering never touches a browser:
**ffmpeg / AWS MediaConvert decode the alpha channel natively.** So an alpha stinger reveals the
footage exactly as authored, and the flattened export carries no alpha at all. (Live broadcast
graphics are shelved for now — see the end of this doc — but if we build them later they'd need an
*opaque* or CSS-driven version of the same stinger. Author both encodes from one master.)

## Architecture fit (event-sourced)

Everything the clip needs already exists:

- **Video source.** Finished games have VODs in S3 (`bandbox-recording`, served via CloudFront):
  the per-angle individual recordings (`games.ivs_replay_angles`) and/or the composite
  (`games.ivs_replay_url`). A clip is a **time range** cut from one of these HLS VODs.
- **Clip timing from the log.** `bpw.game_events` carries each event's `wall_clock_ts`, and
  `games.recording_started_at` anchors video-time-zero. So a play at seq N maps to a video offset:
  `videoSec = (event.wall_clock_ts − recording_started_at) / 1000`. The clip range is
  `[videoSec − PREROLL, videoSec + POSTROLL]` (e.g. −4s / +8s, tuned per play type). This is the
  exact same wall-clock↔video-time math the replay player already uses.
- **Lower-third data from the log.** Project the event log up to the play (we already do this for the
  scorebug/box score) to get score, inning/half, batter, and the play description — the same
  `describePlay()` + `displayName()` we use everywhere. No manual data entry.
- **Angle choice.** For multi-angle games the user can pick which angle to clip (default the phone),
  reusing the per-angle VOD URLs.

## Render pipeline

Trigger → resolve → render → deliver:

1. **Trigger.** User taps "Share" on a play (Plays tab / Final screen / a surfaced highlight).
2. **Resolve** (Edge Function): compute the clip range (above), pick the source VOD + angle, and
   build the lower-third payload (score/inning/batter/result) from the event log.
3. **Render** (AWS MediaConvert **or** ffmpeg in a container/Lambda):
   - **Input clipping** — cut `[start,end]` from the source HLS VOD.
   - **Stinger** — composite the alpha stinger over the opening (`enable='between(t,0,STING_LEN)'`);
     transparent regions reveal the footage. Mix the stinger whoosh over the head audio.
   - **Lower-third bug** — overlay the generated lower-third PNG/SVG (persistent, or slid in/out).
   - **End card** — append the outro (concat) or wipe out over the tail.
   - **Output** — flatten to H.264/MP4 at the target canvas (below), write to a public/share prefix.
   - ffmpeg does this in one `filter_complex` (overlay chain + concat); MediaConvert does it with
     input clipping + **Motion Image Inserter** (accepts alpha .mov / PNG sequence) + input stitching
     for the end card. Either is fine; ffmpeg gives finer control over arbitrary alpha video overlay.
4. **Deliver.** Return the MP4 URL (CloudFront) for the native share sheet / download. Cache the
   rendered clip keyed by (game, play, angle, canvas) so re-shares are instant.

Cost is a few seconds of compute per clip. All secrets/creds stay in the Edge Function / render job,
never client-side (same rule as the rest of the stack).

## The one decision that shapes the assets: canvas / aspect ratio

Social is mostly **9:16 vertical** (Reels / TikTok / Shorts); game video is **16:9**. Options:

- **Letterbox into 9:16 (recommended default):** game footage centered in a 9:16 canvas, with the
  stinger, bug, and end-card filling the top/bottom brand bands. Clean, keeps the full field in frame,
  and gives the graphics natural real estate. Author the stinger's safe area to these bands.
- **Crop to 9:16:** fills the screen but loses the sides of the field (bad for baseball framing).
- **Keep 16:9:** best for YouTube / X / in-app; worst for the vertical feeds.

Recommendation: **render 9:16 by default, 16:9 as an option.** Lock this before authoring assets — it
determines the stinger's transparent-reveal geometry and where the bug/end-card sit.

## Asset checklist (author to these specs)

- **Stinger (intro):** alpha-preserving master — **ProRes 4444 (.mov)** (best), or VP9-alpha `.webm` /
  PNG sequence. ~1.5–3s. Design the reveal to the chosen canvas's safe area. (MP4/H.264 cannot carry
  alpha — don't deliver the stinger as MP4.)
- **Lower-third bug:** either a static alpha **PNG** logo bug, or — preferred — a **templated layout**
  we fill per-clip from the event log. Brand fonts baked in: **Alfa Slab One** (display), **Saira
  Condensed** (labels/numerals), **Archivo** (data). Brand palette: cream / ink-navy / barn-red /
  board-green / gold. Hard corners, no shadows (the one allowed is the 6px hard offset).
- **End card:** full-frame outro — plain MP4/PNG (no alpha needed). Final score / matchup / CTA.
- **Canvas:** 1080×1920 (9:16) primary; 1920×1080 (16:9) secondary.

## Open decisions / sequencing

- [ ] Lock the canvas (9:16 default vs both).
- [ ] Static brand bug vs auto-data lower-third (recommend auto-data — it's our differentiator and the
      data is free from the log).
- [ ] Preroll/postroll defaults per play type (HR longer, routine out shorter); allow a trim UI later.
- [ ] Render engine: MediaConvert (managed, less ops) vs ffmpeg-in-Lambda/container (finer control).
- [ ] Where clips live + retention (share prefix + CloudFront; cache by key).
- [ ] Highlight auto-surfacing (which plays to suggest: HRs, scoring plays, defensive gems).
- [ ] Consent / name-safety: clips are public artifacts — respect the members-aware name floor
      (`displayName` public level) in the burned-in bug, same as the public overlay.

## Explicitly out of scope here

- **Live broadcast graphics** (stinger/transitions in the live stream) are **shelved.** If revisited,
  the practical path is a client-side graphics layer in the viewer app driven by the event log
  (`game_start` / `inning_change` / 3rd-out / `game_end`), reusing the between-innings + Starting-Soon
  screens — not a server-side mixer. Live would need an opaque/CSS version of the stinger.

## Monetization (decided 2026-07-11)

Clips are a **paid** feature — and specifically a **personal** good, so they belong to the parent,
not the team. This follows the "two goods / two payers" split in the pricing model
([ballpark-watch-pricing](../../../.claude/projects/-Users-bwiseman-projects-ballpark-watch/memory/ballpark-watch-pricing.md)):

- **Free = live-only** (P2P, ~5-viewer cap). **No free replay** (the earlier 24h "taste" is dropped).
  Nothing to clip on a free game — clips require a recording, and recording is paid.
- **Broadcast good (SHARED, per-game, bought once):** recording/replay/HD/AI. Payer = **team**
  (~$149/season) or anyone via a **single-game pass (~$8)**. This makes the recording *exist* — once,
  regardless of how many families want clips.
- **Personal good (PRIVATE, per-family):** **Parent/Family premium (~$29/season)** unlocks
  **create + share branded clips of your kid**, the personal highlight reel, keepsake downloads,
  recruiting export. The render off an already-recorded game is pennies, so there's **no double
  cost** — the team funds the recording; the parent pays to extract their kid's highlight.

Why this is consistent with "charge the team, not the parents": watching stays **free**; the parent
tier sells a **keepsake**, never access. It's the inverse of GameChanger's single $99.99 Premium that
gates watching *and* clips together — we split them, keep watching free, and price each below GC.

**Optional viral seed (parked growth lever):** a limited **sponsor-presented free clip** (carries a
local sponsor's bug — markets Bandbox + the sponsor); Parent premium removes the bug and unlocks
unlimited + the season reel.

**Sequencing:** validate the **broadcast good first** (it's the wedge and it's what makes recordings
exist), then add **Parent premium for clips** as the second monetization test (parents are the most
motivated, highest-volume clip buyers, and it's recurring).

## Related

- IVS video + recording: [ivs-migration-plan.md](ivs-migration-plan.md)
- Master plan: [bandbox-plan.md](bandbox-plan.md)
- Names / privacy floor: `src/lib/names.ts` (`displayName`), and the membership-aware public-name work
  noted in the README's privacy section.
