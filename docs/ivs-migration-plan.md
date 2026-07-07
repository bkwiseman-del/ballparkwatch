# Bandbox video: Cloudflare Stream → Amazon IVS migration plan

**Status:** spike PASSED (2026-07-07). All four make-or-break capabilities verified with real
feeds against a live IVS account (`639914975430`, us-east-1). This doc is the build plan.

## Why we're moving
Cloudflare Stream failed four hard requirements, each verified as a dead end:
1. Won't record WHIP → forced a brittle DIY GStreamer recorder (Railway).
2. Can't trim a live recording → replays contained pre-game footage.
3. HLS has no timecode/timed-metadata → scorebug/commentary couldn't sync to RTMP video.
4. Per-viewer-forever billing model.

IVS clears all four (spike evidence in `/tmp/ivs-spike`, summarized below).

## What the spike proved (evidence)
- **Dual ingest on one stage.** A WHIP phone (global endpoint `https://global.whip.live-video.net`,
  bearer = participant token, **stereo Opus required**) and an RTMP camera (ingest-configuration
  stream key) were both `published=True, CONNECTED` on the same stage at once.
- **No-pre-game recording.** Feeds ran 5+ min, then `StartComposition`→S3, 46s later
  `StopComposition`. Recording = **47s**, `recording_started_at` = the StartComposition instant.
  Composite recording HLS has **no** PROGRAM-DATE-TIME, but `recording-started.json` gives an exact
  wall-clock anchor (better than PDT).
- **Timed-metadata sync.** On a low-latency channel, `put-metadata` payloads landed embedded as a
  `timed_id3` data stream in the segment matching send-time, in order, payload intact. Channel HLS
  **does** carry PROGRAM-DATE-TIME.

## Target architecture (per game)
One IVS **stage** per game handles ingest; viewer/record paths branch by need.

```
 PHONE (WHIP, <300ms) ─┐
                       ├─►  IVS STAGE  ──►  Composition ──► S3 (HLS VOD)   [recording, no pre-game]
 CAMERA (RTMP, 2–5s) ──┘        │
                                ├─►  WebRTC subscribe (IVS real-time SDK)  [phone games: sub-second live]
                                └─►  broadcast → Low-Latency CHANNEL ──► HLS + put-metadata
                                                                          [camera games / scaled: synced scorebug]
```

**Live viewing, by source:**
- **Phone games** → viewers subscribe to the stage over WebRTC (sub-second). Scorebug rides existing
  Supabase Realtime; both are <1s so they're naturally in sync. No timed metadata needed.
- **Camera games (and any large audience)** → broadcast the stage to a low-latency channel; viewers
  watch HLS. Scorebug/commentary delivered as **timed metadata** (`put-metadata`), synced to frames
  regardless of the 2–5s latency. (RTMP is never sub-second by nature — expected.)

**Recording (both):** composition from the stage, `StartComposition` at `game_start` /
`StopComposition` at `game_end` → S3. Replay served from S3/CloudFront. Replay scorebug sync = the
exact `recording_started_at` anchor + event wall-clocks.

**PDT vs put-metadata — the sync mechanism, settled (verified 2026-07-07):**
- The **composite recording** (replay VOD) has **NO** `PROGRAM-DATE-TIME` (0 tags). Replay therefore
  syncs off the `recording_started_at` anchor — never PDT.
- The **live low-latency channel** DOES carry `PROGRAM-DATE-TIME`. It's tempting to reuse the existing
  PDT/`onVideoClock` path for live camera sync, but we DON'T: (a) it's browser-lib-dependent
  (hls.js/Safari surfacing PDT correctly), and (b) it shares the same inherent
  scorer-reaction-vs-ingest-latency offset as put-metadata anyway. So there's no accuracy win, only
  fragility. **Live sync uses `put-metadata` → `amazon-ivs-player` `TEXT_METADATA_CUE`** — the
  mechanism we proved in-band end-to-end. The cue payload is compact (`{s:seq, scorebug fields}`); the
  viewer renders the bug from the cue and drives field/commentary from its event log up to `seq`.
- Honest caveat: BOTH mechanisms stamp at server time, so a small (scorer-reaction − ingest-latency)
  offset is inherent. The transport is proven; the *timing feel* must be measured with a real camera +
  scorer in a browser before we call live sync done.
- *Option to revisit:* record the **channel** (not composition) for camera games so the VOD carries
  the timed metadata + PDT and the IVS player fires synced cues on replay for free. Trade-off:
  channel auto-record captures the whole session, so no-pre-game needs feed-start control. Composition
  is cleaner for no-pre-game; anchor-based replay sync already works. Decide during build.

## Cost model (per 2-hr game, us-east-1)
- Real-time stage participants: $0.072/participant-hr (publishers + any WebRTC viewers).
- Low-latency channel: ~$2/hr input + ~$0.072/HD-viewer-hr output (CDN, scales cheap).
- **Replays: S3 + CloudFront egress only — NOT per-viewer streaming.** The long-tail re-watching is
  cheap CDN, not live billing.
- Ballpark: **$2–12 live per game**; replays pennies. Spike cost: <$1.

## File-by-file changes

### Delete outright
- `recorder/` (record.py, server.js, Dockerfile) — its only reason to exist (Cloudflare won't record
  WHIP) is gone. Retire the Railway service.

### Backend — `supabase/functions/stream-live/index.ts`
Swap Cloudflare REST calls for IVS (AWS SigV4-signed; use `aws4fetch` in Deno). Actions:
- `start`: create/reuse a **stage**; mint a **participant token** (phone WHIP) and/or an
  **ingest-configuration** stream key (camera RTMP). For camera games also create + start a
  **channel** and return its HLS playback URL. Persist IVS ARNs on the game row.
- `game-start` (new, or fold into first pitch): `StartComposition` → S3.
- `put-metadata` (new): given game token + payload, call `ivs put-metadata` on the channel (scorebug
  + commentary cue). Called by the scorer on each event for camera/HLS games.
- `stop-input`/`game-end`: `StopComposition`, stop channel broadcast, disable ingest.
- `finalize`: read `recording-started.json`/`recording-ended.json` from S3 → set replay URL
  (S3/CloudFront) + `recording_started_at`. Drop all tus/Cloudflare recorder coordination.

### DB migration (new file)
- Replace `cf_*` columns with `ivs_*`: `ivs_stage_arn`, `ivs_channel_arn`, `ivs_playback_url` (HLS),
  `ivs_ingest_url` + `ivs_ingest_key` (camera), `ivs_recording_prefix`. Keep `recording_started_at`,
  `video_source`, `video_config`, `stat_delay_ms` (latter likely unused post-migration).
- New/renamed RPCs mirroring `stream_attach` / `stream_set_replay` / `game_bounds`
  (service role has RPC-only access to `bpw`).

### Client publish — `src/lib/whip.ts`, `src/components/VideoSetup.tsx`, `PhoneVideo.tsx`
- Phone: publish via **IVS Web Broadcast SDK** (`amazon-ivs-web-broadcast`) instead of hand-rolled
  WHIP (more robust; handles the stereo-Opus/SDP details). VideoSetup phone section points at the
  stage + token.
- Camera: VideoSetup shows the IVS **RTMP ingest URL + stream key** (from ingest-configuration).

### Playback + sync — `src/lib/hls.ts`, `src/routes/Watch.tsx`
- Replace hls.js with **amazon-ivs-player** for HLS. It emits `TEXT_METADATA_CUE` events **synced to
  playback** → parse scorebug/commentary JSON and apply. **This deletes the fragile PDT / delay /
  fireDue machinery** in Watch.tsx.
- Phone games: subscribe to the stage via the IVS real-time SDK (sub-second); keep Supabase-Realtime
  scorebug.
- Replay: IVS player on the S3 VOD; scorebug via `recording_started_at` anchor + events (or via
  metadata cues if we record the channel — see architecture option).

### Scoring — `src/routes/Score.tsx`
- Game start → `stream-live` `game-start` (StartComposition; start channel for camera).
- Each scored event (camera/HLS games) → `stream-live` `put-metadata` with the scorebug + any
  commentary cue.
- Game end → `stream-live` `game-end` (StopComposition + stop channel).

### New dependencies
- Client: `amazon-ivs-web-broadcast` (publish + real-time subscribe), `amazon-ivs-player`
  (HLS + synced metadata cues).
- Edge: `aws4fetch` (SigV4) or AWS SDK v3 clients.

## Still to verify during build (not blockers, but prove before shipping)
1. **Browser WHIP stereo**: our ffmpeg test needed `-ac 2`; confirm the IVS Web Broadcast SDK / a real
   phone negotiates stereo Opus cleanly (SDKs normally handle this).
2. **Stage → channel broadcast** latency + the exact API wiring (spike proved channel `put-metadata`
   standalone and stage→composition; wiring stage output into a channel is the one untested seam).
3. **Least-privilege IAM**: the spike used AdministratorAccess. Replace with a policy scoped to the
   exact actions we call (`ivs:*`/`ivsrealtime:*` subset + the recordings bucket). Detach admin.

## Build sequence
1. Backend `stream-live` IVS rewrite + DB migration + IAM scope-down. (spine)
2. Camera path end-to-end: RTMP ingest → channel HLS → IVS player + `put-metadata` scorebug. (proves
   the synced-scorebug win on the source that needs it most)
3. Phone path: IVS Web Broadcast publish → real-time subscribe. (sub-second)
4. Recording/replay: composition → S3 → IVS player VOD + anchor sync.
5. Delete `recorder/`, remove Cloudflare code/secrets, retire Railway.
