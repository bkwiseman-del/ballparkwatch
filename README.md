# Bandbox ⚾

Live baseball scoring & streaming for youth and amateur leagues. One parent scores
play-by-play; family watches a live video stream with a synchronized scorebug — or
just the stats, no video required. A browser-based PWA, built in the spirit of
GameChanger but around an **event-sourced** core: every pitch is an immutable event,
and the scorebug, box score, AI voice commentary, and recap are all projections of
that log.

## Quick start

```bash
npm install
cp .env.example .env.local   # already populated locally with shared Supabase values
npm run dev                  # http://localhost:5173
npm run build                # tsc -b && vite build
npm run typecheck
```

Sign up / sign in, then create a team, add players, and create a game. Open the
scorer at `/score/:gameId` and share the public viewer link (`/watch/:gameId`) with
family — no account needed.

## Project layout

```
src/
  auth/         AuthProvider + RequireAuth route guard
  routes/       Login · Setup · Lineup · Score · Watch · Broadcast (phone capture)
  components/   ScorePanel · Scorebug · FieldDiamond · VideoSetup · PhoneVideo · ShareSheet …
  hooks/        useScorer (event log + write-ahead log + realtime broadcast)
  lib/          engine (event sourcing) · stats (box score / play-by-play) · audio
                · commentary · recap · phoneVideo (WebRTC) · supabase client (bpw schema)
supabase/
  migrations/   bpw schema, event-sourced model, ownership-based RLS, public-viewer RPCs
  functions/    commentary (ElevenLabs TTS) · recap (Claude) · scan-lineup (Claude OCR)
                · ice-servers (WebRTC TURN)
public/sfx/     crowd bed + pitch / hit / catch / cheer / organ / charge stingers
docs/           build plan, full design handoff, product strategy
```

## Database setup

The app uses a dedicated **`bpw`** schema inside a shared Supabase project. Apply the
migrations in [supabase/migrations/](supabase/migrations/) via the Supabase **SQL
editor** (paste each file, oldest first), then add `bpw` to the project's **exposed
schemas** (Settings → API → `public,graphql_public,twp,bpw`). See
[CLAUDE.md](CLAUDE.md) for the full rationale (shared project, ownership-based RLS,
why we don't use `supabase db push`).

## Status

Built and in real-game use (scored live youth games as of June 2026):

- **Phase 0 — Scaffolding** ✅ — auth, design tokens, route shells, schema, Setup CRUD.
- **Phase 1 — Scoring + live scorebug** ✅ — full play-by-play cockpit (pitches,
  baserunners, substitutions, in-play resolver, undo/edit any past play), live scorebug
  + box score (batting R/H/RBI, pitching IP/H/R/ER/BB/K) projected from the event log,
  realtime push to the public viewer, share links, write-ahead log for crash safety.
  Plus a lightweight **Scoreboard mode** (runs/hits/outs/count only, no lineup).
- **Phase 2 — Video layer** ✅ (evolving) — moved off phone-to-phone/YouTube onto **Cloudflare
  Stream**. The phone broadcasts via **WHIP** (sub-second **WHEP** playback for viewers); an
  **external camera / encoder** broadcasts via **RTMP** (Cloudflare records it natively).
  YouTube is legacy-only. Replay of a phone (WHIP) broadcast is captured by a **server-side
  recorder** (Railway container, GStreamer `whepsrc` → `x264enc` mp4) — a deliberate BRIDGE
  until Cloudflare ships WHIP recording, at which point it's deleted. Viewer scorebug **and AI
  commentary sync to the video's own timestamp** (HLS `PROGRAM-DATE-TIME`) for external cams,
  with a manual-delay fallback for WHEP / no-PDT streams.
- **Phase 3 — AI voice commentary** ✅ — GameChanger-style audio: synced sound FX,
  ElevenLabs play-by-play (content-hash cached to cut cost), stadium reverb, crowd bed,
  organ/charge stingers.
- **Phase 4 — AI lineup scan + recap** ✅ — Claude OCR of a lineup photo; Claude-written
  game recap on the final screen, built from the saved event log.
- **Phase 5 — Voice scoring** ⬜ — stretch; not started.

See the phased plan in [docs/baseball-app-build-plan.md](docs/baseball-app-build-plan.md),
the unified [docs/bandbox-plan.md](docs/bandbox-plan.md), and the recorder spec in
[docs/bandbox-server-recorder-spec.md](docs/bandbox-server-recorder-spec.md).

## Known limitations & open work (as of July 2026)

**Streaming / recording — the active frontier:**

- **The recorder is a deliberate bridge.** Cloudflare doesn't yet record WHIP ingest, so we
  hand-built a GStreamer recorder to fill the gap. When Cloudflare ships WHIP recording, **delete
  the recorder** — it's throwaway. (RTMP cameras already record natively; the recorder only ever
  covers phone-WHIP angles.)
- **Recording does NOT survive a mid-game stream cut + restart** — the recorder truncates at the
  drop and doesn't reconnect. Segment-record-and-stitch (with gap fill) is the **top pending
  recorder task**.
- **Intermittent live-stream freezes / drops** — not fully root-caused. Removed the recorder's
  per-loss keyframe-request "PLI storm" (a documented SFU feedback-loop risk) and added a 30s
  recorder `HEALTH` log; needs real-game data to confirm the cause.
- **Fixed and shipped recently:** Cloudflare TURN for the recorder's WHEP; keyframe PLI on the
  real `webrtcbin` pad; `+faststart` + constant 30fps + pinned 1280×720 (fixed Safari-black and
  minutes-long frozen frames); scorebug **and** commentary timestamp-sync (PROGRAM-DATE-TIME).
- **Needs one real RTMP test to confirm:** external-cam replay resolves to the *finalized* VOD
  (not the still-live input); `PROGRAM-DATE-TIME` is present so scorebug + commentary auto-sync
  and the manual delay slider becomes unnecessary.

**Scorer reliability — recently fixed:** reload/app-switch no longer loses plays (recovery keyed
on the `game_start` event + a `game_state` reconcile covering inning/outs, not just score); the
inning-break "End game" button is reachable (scrollable); set-any-lineup-player-as-batter
(`set_batter` event) for guessed opposing orders.

**Privacy / name-safety — planned, not built:** `get_public_game` returns player names to anyone,
so today's name shortening is cosmetic, **not** privacy. Next: make name resolution
**membership-aware and server-enforced** (public → first name + last initial / jersey number;
logged-in team members → full names), gated through the single `displayName()` chokepoint. Ties
into the family/follower epic.

**Also up next:** pitch-count alerts, offline resilience, season stats, viewer notifications, and
migrating `bpw` to its own Supabase project once validated.

**Strategy note:** managed recording egress (LiveKit / Mux) is ~5–7× the current Cloudflare cost
because it bills per viewer-minute — bad for the "family never pays, sponsor-funded" model. The
cheap **and** easy long-term path is a native broadcaster app doing RTMP (Cloudflare records
natively) or simply waiting for Cloudflare's WHIP recording. Keep the DIY recorder as a bridge,
not a permanent investment.

## Deploy

The PWA deploys to **Vercel** on push to `main` (production). Supabase Edge Functions
deploy separately:

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy <name> --no-verify-jwt \
  --project-ref dlroexthlluabuiqdiip
```

Installed PWAs cache the previous bundle until fully reopened — after a deploy, swipe
the app away and relaunch (a tab refresh alone may not pick up the new service worker).
