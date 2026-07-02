# Bandbox — Server-Side Replay Recorder (spec)

> The durable, full-quality replay path. Companion to the recording note in
> [bandbox-plan.md](bandbox-plan.md). Built because Cloudflare **WHIP does not record**
> (confirmed 2026-07) and 480p on-phone recording can't be the long-term answer,
> especially for paid accounts.

## Goal

Capture the **full-quality** live stream **server-side** and deliver it as the replay,
**without touching the sub-second live path or the phone's encode.**

The phone keeps doing exactly one thing: WHIP full-quality → Cloudflare Stream → viewers
watch sub-second via WHEP (unchanged). A separate service *watches* that stream and
records it.

## The load-bearing principle: PASSIVE SUBSCRIBER, not a relay

The recorder is **just another viewer** of the live stream. It is **not** in the path
between the phone and the viewers. Consequences:

- **No added live latency** — live is still phone → Cloudflare → viewers, direct.
- **Not a live-path SPOF** — if the recorder crashes/OOMs/restarts, viewers keep
  watching; the only casualty is that game's replay (which we can retry).
- **Full quality** — it records whatever the phone streamed (e.g. 720p), no on-phone
  downscale, no extra phone heat, no second phone encode.

## Data flow

```
phone ──WHIP──▶ Cloudflare Stream Live Input A ──WHEP──▶ family viewers   (live, sub-second, unchanged)
                                              │
                                              └─WHEP──▶ RECORDER (headless) ──RTMP──▶ Live Input B ─▶ VOD (the replay)
                                                                                      (recording.mode=automatic)
```

- **Live Input A** = today's per-game live input (WHIP ingest, WHEP playback). Unchanged.
- **Recorder** = a headless process that subscribes to Input A's WHEP URL and re-publishes
  to **Live Input B** via **RTMP**. Cloudflare records Input B (RTMP *does* record), builds
  the ABR ladder, and hosts the replay VOD.
- Video is **H.264 passthrough** (no re-encode). Only audio needs a light transcode
  (WebRTC **Opus → AAC** for RTMP/FLV). CPU stays low.

Alternative (no second live input): recorder writes an MP4 locally and uploads to Stream
via the direct-upload API or to R2. The WHEP→RTMP→Stream form is preferred because
Cloudflare then owns record + ABR + replay hosting; we run only the thin bridge.

## Recommended stack

- **Bridge:** **Pion (Go)** or **GStreamer** (`whepsrc`/webrtcbin → depay → flvmux →
  rtmpsink). Both do H.264 passthrough + Opus→AAC cheaply. **Avoid headless Chromium** as
  the recorder — a full browser per stream is far heavier than a native WebRTC client.
- **Container:** ~0.5–1 vCPU, ~512 MB–1 GB RAM per concurrent broadcast (passthrough, so
  it's mostly I/O + audio transcode).
- **Host:** a platform with fast per-job containers — **Fly.io Machines**, **Cloud Run**,
  **Railway**, or **Cloudflare Containers**. One machine per concurrent broadcast; idle
  cost ≈ $0 (spun up on demand, torn down on end).

## Lifecycle / orchestration

1. **Paid broadcast goes live** (WHIP connects). The `stream-live` edge function (or a
   small orchestrator it calls) **launches a recorder** for that game, passing: Input A's
   **WHEP URL**, a freshly-minted **Live Input B** (its RTMP URL + key), and the game id.
   *(Only for PAID games — free games use local recording.)*
2. Recorder connects WHEP → forwards RTMP to Input B. Cloudflare records Input B.
3. **Broadcast ends** (WHEP stream stops / game goes final). Recorder detects the end,
   flushes, and exits. The container is torn down.
4. Cloudflare finalizes Input B's VOD (~60s). Store its `cf_recording_uid` on the game
   (reuse the existing `stream_set_recording_by_game` RPC + the viewer's on-demand
   `finalize` poll — both already built).
5. Replay = Input B's VOD (full quality). Viewer code already prefers the Stream VOD.

Robustness: recorder **auto-reconnects** to WHEP through blips (the live stream can drop
and resume); on repeated failure it exits and we fall back to the phone's local recording
for that game (so a paid game never ends up with *no* replay).

## Free / paid split (product tiering)

| | Live | Replay | Infra cost |
|---|---|---|---|
| **Free** | WHIP/WHEP sub-second | **local** device recording (~480p) | $0 |
| **Paid** | WHIP/WHEP sub-second | **server-side** full quality | ~$0.05–0.15/game |
| **Field cam** | RTMP or WHIP | **RTMP-direct → Stream** (native record) | ~$0 extra |

The quality difference is *earned by* the compute we spend on paid games — cost tracks
value, and free still gets a real replay.

## Cost

- **Compute:** ~0.5–1 vCPU × ~2h/game. Scales with **concurrent** broadcasts, not total.
  ~**$0.05–0.15/game**. A busy Saturday of 20 simultaneous games ≈ 20 machines for that
  window (~$1–3), then back to ~$0.
- **Cloudflare:** Input B storage (paid = keep; or `deleteRecordingAfterDays`/manual
  cleanup) + the recorder counts as one WHEP viewer of Input A (~$0.12/game delivery).
- **Net:** a durable, full-quality replay for well under a quarter per paid game.

## Build checklist

- [ ] Recorder image: Pion/GStreamer WHEP-in → RTMP-out, H.264 passthrough + Opus→AAC,
      auto-reconnect, clean exit on stream-end.
- [ ] Orchestrator: launch/stop a recorder per **paid** broadcast (Fly Machines / Cloud
      Run API) from the `stream-live` edge function on go-live; mint Live Input B.
- [ ] Wire Input B's VOD back to the game (existing `stream_set_recording_by_game` +
      viewer `finalize` poll already handle this).
- [ ] Fallback: if the recorder fails, keep the phone's local recording for that game.
- [ ] Retire path: if/when Cloudflare ships WHIP recording, delete the bridge and set
      `recording.mode=automatic` on Input A.

## Open questions

- Host choice (Fly Machines vs Cloud Run vs CF Containers) — pick on cold-start speed +
  per-second billing + WebRTC/UDP egress support.
- Do we even need Input B, or upload an MP4 to Stream/R2 directly? (B is simpler for ABR +
  hosting; direct upload avoids a second input's delivery cost.)
- Audio: confirm the WHEP feed's Opus params so the AAC transcode is trivial.
