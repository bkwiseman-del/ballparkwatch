# Baseball Live Stats & Streaming App — Build Plan

> Handoff spec for Claude Code. Personal-use app to livestream a youth baseball game with a live scorebox and stats to family, similar in concept to GameChanger. Build **phase by phase**, top to bottom. Each phase has an acceptance test; don't move on until it passes.

---

## 1. Product summary

A browser-based PWA (no native app) that lets one operator score a baseball game play-by-play while family watches a live video stream with a synchronized scorebug and stats. Video is **optional** — the app must work in three modes:

1. **Phone as camera** (browser captures + streams)
2. **External camera** (GoPro / DJI / Mevo via RTMP, or straight to YouTube)
3. **No video** — stats and scorebug only

Latency is acceptable; the system delays the scorebug/audio to match whatever video lag exists.

Later phases add AI: spoken play-by-play commentary, a "scan the lineup card" importer, an auto-generated recap, and (stretch) hands-free voice scoring.

---

## 2. Core principle: the stats are the spine

Build this as an **event-sourced** system. Every pitch, hit, and out is an immutable row in an event log. Everything else is derived from or attached to that log:

- The live score, count, and box score are **projections** of the event log.
- Video is a **separate optional layer** overlaid at viewing time — it never changes the data model.
- Every AI feature is just another **producer** (writes events) or **consumer** (reads the log).

This is what makes "stream, or just score" fall out for free, exactly like GameChanger.

```
INPUTS                EVENT LOG (Supabase)            OUTPUTS
  scoring taps  ─┐                                ┌─►  live scorebug + stats
  voice scoring ─┼──►  immutable game_events  ────┼─►  AI voice commentary
  lineup scan   ─┘     + game_state snapshot      └─►  post-game recap

VIDEO (optional, orthogonal): phone WHIP | camera RTMP | YouTube | none
       → delivered to viewer → scorebug overlaid with a delay buffer
```

---

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript, as a PWA (`vite-plugin-pwa`) | SPA with route-based surfaces. No native code. |
| Styling | Tailwind CSS | |
| Backend data | Supabase: Postgres + Auth + Realtime + Storage + Edge Functions | Realtime drives the live scorebug. Edge Functions hold all secret API keys. |
| Video infra | Cloudflare Stream | WHIP ingest + WHEP playback (phone, sub-second) and RTMP ingest + LL-HLS (camera). Managed; no media server to run. |
| Free video alt | YouTube Live (unlisted) | For the external-camera path when zero cost matters; viewer embeds the IFrame player. |
| Players | `hls.js` (LL-HLS), Cloudflare WHEP reference client (WebRTC), YouTube IFrame API | Pick per game's video source. |
| TTS | ElevenLabs (low-latency "Flash" streaming voices) | Called only from an Edge Function. Use a generic voice — do not clone a real broadcaster. |
| Vision / LLM | Anthropic API (Claude) | Lineup OCR/extraction, recap generation, commentary color text. Called only from Edge Functions. |
| Hosting | Cloudflare Pages or Vercel | |

> Alternative if integrated server routes are preferred: Next.js instead of Vite, using Route Handlers in place of some Edge Functions. Default to Vite + Supabase Edge Functions for simplicity.

---

## 4. Data model (Supabase / Postgres)

Source of truth is `game_events`. `game_state` is a cached snapshot updated as events are written, so viewers can subscribe to one row for instant scorebug updates without replaying the log.

```sql
teams        (id, name, season, created_at)

players      (id, team_id, name, jersey_number,
              default_position, bats, throws, created_at)

games        (id, home_team_id, away_team_id, scheduled_at,
              status,                       -- scheduled | live | final
              video_source,                 -- none | phone_whip | camera_rtmp | youtube | cloudflare_hls
              video_config jsonb,           -- ingest/playback ids, youtube_video_id, etc.
              stat_delay_ms int default 0,  -- how far to delay scorebug/audio to match video
              created_at)

lineup_entries (id, game_id, team_id, player_id,
                batting_order, position, is_starter)

game_events  (id, game_id, seq,             -- monotonic per game
              wall_clock_ts timestamptz,    -- for delay/sync math
              inning int, half,             -- top | bottom
              event_type,                   -- see taxonomy below
              batter_id, pitcher_id,
              payload jsonb,                 -- result detail, fielders, RBIs, runner advances
              created_at)

game_state   (game_id PK,                   -- ONE row per game, upserted as events arrive
              inning, half, outs,
              balls, strikes,
              home_score, away_score,
              runner_first, runner_second, runner_third,  -- player_id or null
              current_batter_id, current_pitcher_id,
              updated_at)

commentary_cache (id, game_event_id, text, audio_url, created_at)  -- optional, avoids re-generating
recaps           (game_id PK, body_text, generated_at)
```

`event_type` taxonomy (extensible): `pitch_ball`, `pitch_strike`, `pitch_foul`, `pitch_in_play`, `single`, `double`, `triple`, `home_run`, `walk`, `strikeout`, `groundout`, `flyout`, `lineout`, `error`, `fielders_choice`, `hit_by_pitch`, `sub`, `inning_change`, `game_start`, `game_end`. Detail (hit location, RBIs, runner advancement, fielders involved) goes in `payload`.

Season/box-score stats are SQL views or app-side aggregations over `game_events`. Start with the essentials needed for the scorebug and a basic box score; expand later. Do **not** try to ship 150 stats in v1.

Enable Row Level Security on all tables. Writes restricted to the authenticated operator; reads for a game allowed via either auth or an unguessable share token on `games`.

---

## 5. Web surfaces (routes)

- **`/setup`** — manage teams, players, schedule; create a game and pick its `video_source` + config.
- **`/score/:gameId`** — operator scoring console. Pitch/result entry, baserunner state, substitutions, lineup, start/stop video session, live `stat_delay_ms` slider. Writes `game_events` and upserts `game_state`.
- **`/watch/:gameId`** — viewer. Renders the correct video player for the game's source (or stats-only), overlays the HTML scorebug, shows box score, and plays AI commentary audio. Subscribes to `game_state` via Realtime and applies updates through a **delay buffer** of `stat_delay_ms`.

Auth: simple email/password (Supabase Auth) for operators; viewers reach `/watch/:gameId` via a share link (token) — no account required.

---

## 6. Video integration

The viewer selects its pipeline from `games.video_source`:

- **`none`** — stats-only board. No player.
- **`phone_whip`** — `/score` (or a dedicated capture view) uses `getUserMedia` → publishes via **WHIP** to a Cloudflare live input. Viewer plays via **WHEP** (sub-second). Use the Screen Wake Lock API to keep the capture screen on. **Known fragility:** browser tabs suspend when backgrounded/locked (esp. iOS Safari) and the phone heats over a long game — keep it foregrounded, plugged in, and **test a full-length capture early**. Fallback that needs no native code: point the **Larix Broadcaster** app at the same Cloudflare WHIP URL (confirmed compatible) for reliable background capture.
- **`camera_rtmp`** — external camera (GoPro / DJI Osmo Pocket 3 / Mevo) pushes custom **RTMP** to a Cloudflare live input; viewer plays **LL-HLS** via `hls.js` (~3-6 s). Camera needs internet at the field — prefer a dedicated cellular hotspot so no personal phone is in the path.
- **`youtube`** — external camera pushes RTMP straight to an unlisted YouTube Live; viewer embeds the YouTube IFrame player (~5-10 s in low-latency mode). Zero video cost; free archive.

### Sync (delay-to-match)
Each game stores `stat_delay_ms` (rough starting points: WHEP ~500 ms, LL-HLS ~4000 ms, YouTube ~8000 ms). The viewer receives `game_state` updates in real time but holds them in a small queue and applies each after `stat_delay_ms`, so the scorebug and audio land in step with the delayed picture. Expose a live slider in `/score` to fine-tune by eye during the game.

Scorebug is rendered as **HTML overlaid on the video element/iframe** in the viewer (not burned into the video). Optional later: canvas burn-in on the capture side if a baked-in bug is ever wanted.

---

## 7. AI modules

All AI calls run in **Supabase Edge Functions** so API keys never reach the browser.

### 7a. Voice commentary (ElevenLabs)
On each new scoring event:
1. Build the call **text** — hybrid: templates for routine plays (`"{batter} grounds out to short."`); a Claude call for moments worth color (home runs, lead changes, a player's first hit) and optional between-pitch filler from live stats. Avoids robotic repetition.
2. Send text to ElevenLabs streaming TTS → audio.
3. Cache `(text, audio_url)` in `commentary_cache` keyed by event.
4. Viewer plays audio through a scheduler aligned to the **same `stat_delay_ms`** so it matches the video.

Sound effects: ship a small set of **pre-recorded clips** (crowd swell, bat crack, cheer) triggered by `event_type` and mixed under the voice with the Web Audio API — instant and free, no per-event SFX generation. Provide a global on/off toggle for commentary.

Baseball's discrete, gap-separated plays make this comfortably real-time — generate during the gap between pitches.

### 7b. Lineup scan (Claude vision)
`/setup` captures a photo of the lineup card (camera or file input) → Edge Function → Claude vision returns structured JSON `[{order, number, name, position}]` → app shows it in an **editable table for human confirmation** (handwriting will occasionally misread — never auto-commit) → writes `players` / `lineup_entries`. Cheap (pennies/scan).

### 7c. Auto recap (Claude)
Post-game Edge Function summarizes the `game_events` log into a short newspaper-style recap stored in `recaps`. Straightforward.

### 7d. Voice-driven scoring (stretch)
Operator speaks plays ("ball," "strike," "ground out to short") → STT (Web Speech API, or Whisper via a function) → intent parse (rules + Claude fallback) → **proposed event shown for one-tap confirm** → write. Directly addresses GameChanger's biggest complaint (operator "feels like a prisoner to the app"). Highest complexity; do last.

---

## 8. Security & secrets

- All third-party keys (Cloudflare, ElevenLabs, Anthropic) live only in Edge Function env — never in client code.
- Row Level Security on every table; operator-only writes; per-game read via auth or share token.
- Cloudflare WHIP publish URLs and playback tokens are sensitive — mint them server-side per game, short-lived.
- Viewer share links use an unguessable token; default unlisted. (Kids on camera — keep streams unlisted/private and disable any public chat.)

---

## 9. Phased build plan

**Phase 0 — Scaffolding.** Vite + React + TS + Tailwind PWA skeleton; Supabase project; auth; run schema migrations (§4); deploy a blank shell to Cloudflare Pages/Vercel.
*Done when:* you can sign in, create a team, add players, and create a game.

**Phase 1 — Scoring + live scorebug, no video (the spine).** Build `/score` to enter pitches/results/baserunners/subs, writing `game_events` and upserting `game_state`. Build `/watch` to show a live scorebug + basic box score driven by `game_state` Realtime.
*Done when:* you score a mock game on one device and watch the scorebug update live on another. **This is the first real milestone.**

**Phase 2 — Video layer (all sources).**
- 2a: `camera_rtmp` + `youtube` paths (these solve the hot-phone problem and are simplest). Per-game video config; viewer plays LL-HLS or embeds YouTube; scorebug overlaid through the delay buffer; live delay slider.
- 2b: `phone_whip` path (WHIP→Cloudflare→WHEP) + Wake Lock; document fragility; verify the Larix fallback hits the same ingest.
*Done when:* you watch a full game with synced video + scorebug via the camera/YouTube path, and the phone path survives a full-length capture test.

**Phase 3 — AI voice commentary.** Edge Function pipeline (event → text → ElevenLabs), SFX clips + Web Audio mixing, viewer audio scheduler on the delay, hybrid template/LLM text, on/off toggle.
*Done when:* live spoken play-by-play with crowd SFX plays in sync and isn't unbearably repetitive.

**Phase 4 — AI operator help.** Lineup scan (vision → JSON → confirm → save) and auto recap.
*Done when:* a photographed lineup card yields an editable roster, and a recap generates after a game.

**Phase 5 — Voice scoring (stretch) + polish.** Mic → STT → intent → confirm → event. PWA install polish, season stats pages, multi-team/multi-kid support.
*Done when:* you can score a half-inning by voice with confirm.

---

## 10. Risks & mitigations

- **Browser capture on a mounted phone is the weakest link** (tab suspension, heat). Mitigate: Wake Lock, foreground + power, test early; fall back to Larix→same ingest, or just use an external camera.
- **Latency desync.** Mitigate: per-game `stat_delay_ms` + live slider; keep the same delay for scorebug and audio.
- **Commentary repetition/cost.** Mitigate: template routine plays, LLM only for highlights; cache audio.
- **Lineup OCR errors.** Mitigate: mandatory human-confirm step before commit.
- **Cloudflare WHIP currently pairs with WHEP only** (HLS-from-WHIP not yet GA). Verify current support before relying on a WebRTC-ingest → HLS or → YouTube-mirror combo; use RTMP ingest when HLS/YouTube output is needed.

---

## 11. Non-goals for v1

Auto-generated highlight clips; native apps; scaling beyond family-sized audiences; monetization; full 150-stat parity with GameChanger.

---

## 12. Services to provision

- Supabase project — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (functions only)
- Cloudflare account + Stream — `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`
- ElevenLabs — `ELEVENLABS_API_KEY`, chosen `ELEVENLABS_VOICE_ID`
- Anthropic — `ANTHROPIC_API_KEY`
- (Optional) YouTube channel for the unlisted-stream path
- Hosting: Cloudflare Pages or Vercel project
