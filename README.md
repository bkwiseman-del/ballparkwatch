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
- **Phase 2 — Video layer** ✅ — runs on **Amazon IVS** (migrated off Cloudflare Stream; see
  [docs/ivs-migration-plan.md](docs/ivs-migration-plan.md)). One **IVS Real-Time stage per game**
  takes both a **phone** (WebRTC/WHIP, sub-second, via the IVS Web Broadcast SDK) and an **external
  camera** (RTMP, from OBS/DJI). **Phone viewers** subscribe to the stage over WebRTC (sub-second),
  scorebug via Supabase Realtime (naturally in sync). **Camera viewers** watch the stage composited
  to a **low-latency HLS channel** (~2–5s), scorebug via **IVS timed metadata** (`put-metadata` →
  `TEXT_METADATA_CUE`), frame-synced despite the delay. **Recording** is a server-side composition →
  **S3** (started at first pitch / stopped at game end, so no pre-game footage), served for replay
  via **CloudFront** (private bucket, OAC). Broadcaster resilience: the phone auto-reconnects on a
  drop; a source-agnostic stage-presence check drives the scorer's "video down" alert for phone and
  camera. YouTube is legacy-only.
- **Phase 3 — AI voice commentary** ✅ — GameChanger-style audio: synced sound FX,
  ElevenLabs play-by-play (content-hash cached to cut cost), stadium reverb, crowd bed,
  organ/charge stingers.
- **Phase 4 — AI lineup scan + recap** ✅ — Claude OCR of a lineup photo; Claude-written
  game recap on the final screen, built from the saved event log.
- **Phase 5 — Voice scoring** ⬜ — stretch; not started.

See the phased plan in [docs/baseball-app-build-plan.md](docs/baseball-app-build-plan.md),
the unified [docs/bandbox-plan.md](docs/bandbox-plan.md), and the IVS video architecture in
[docs/ivs-migration-plan.md](docs/ivs-migration-plan.md).

## Known limitations & open work (as of July 2026)

**Streaming / recording (Amazon IVS) — live and validated:**

- **Camera + phone both live on IVS**, validated end-to-end with real hardware: sub-second phone
  publish + view, external-camera HLS + synced scorebug, composition→S3 recording, CloudFront replay
  with a branded player (baseball scrub handle, mute/volume). The old Cloudflare Stream path + the
  DIY GStreamer recorder (Railway) are **deleted**.
- **Broadcaster resilience:** the phone auto-reconnects on a network drop; a source-agnostic
  stage-presence check drives the scorer's "video down" alert (phone **and** camera). Camera reconnect
  is the external encoder's job. Still to harden with real drop testing.
- **Multi-angle** ✅ (per-angle switcher): a `'multi'` game puts the **phone + external camera** on
  one stage as separate participants; **viewers switch between them via angle tabs**, watched one at
  a time (nothing to keep in sync with each other). Both are delivered over **WebRTC** (sub-second
  *delivery* leg), but glass-to-glass they differ: the **phone is sub-second end-to-end** (WHIP
  ingest), while the **camera is ~2–3s behind** because RTMP ingest adds latency (still better than
  the old composite's ~5s HLS). The scorebug delay tracks the selected angle (phone ≈ 0, camera ≈
  its RTMP-ingest lag, ~2.5s default).
  **Replay is switchable too:** multi games record **each angle to its own VOD** (IVS *individual
  participant recording*), and the Final-screen replay gets the same **Angle 1 / Angle 2 tabs**, each
  re-synced to its own recording timeline; switching resumes at the same game moment. If the per-angle
  recordings aren't available, replay **falls back to the composite VOD** (so it never regresses).
  Phone-only and camera-only games are unchanged. (This replaced the earlier composite/grid live
  view, which couldn't sync a sub-second WHIP phone against a ~2-3s RTMP camera inside one frame.)
  Note: multi live viewers are now billed WebRTC participants (the composite was cheap HLS), so the
  5-viewer cap matters more here. Next: real 2-device validation + add-as-you-go provisioning.
- **Cost cap:** a 5-concurrent-viewer limit for free accounts is written + applied but **dormant**
  (flip on before real exposure). Sub-second WebRTC viewers bill per-viewer; HLS/replay is cheap CDN.
- **IAM:** scope `bandbox-edge` down from AdministratorAccess (used during debugging) to the
  `BandboxEdgePolicy` (IVS + recordings bucket only).

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

**Strategy note:** Amazon IVS won on capabilities Cloudflare fundamentally couldn't do — recording
the WHIP feed, no-pre-game trimming, and timed-metadata scorebug sync — all proven in a spike before
committing. Cost stays aligned with "family never pays, sponsor-funded": **replays are cheap S3 +
CloudFront egress, NOT per-viewer live billing**; only the sub-second WebRTC *live* window bills
per-viewer (~$0.072/participant-hr), bounded by the dormant 5-viewer free cap. ~$2–12 live per game.

## Deploy

The PWA is deployed to **Vercel** manually via the CLI — **pushing to `main` does NOT auto-deploy**
(there's no GitHub→Vercel Git integration on this project; the repo is CLI-linked via `.vercel/`).
Deploy production with:

```bash
npx vercel --prod --yes    # builds + deploys the current tree, aliases bandbox.tv
```

(To make pushes auto-deploy instead, connect the GitHub repo in the Vercel dashboard, or run
`npx vercel git connect`.) Supabase Edge Functions deploy separately:

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy <name> --no-verify-jwt \
  --project-ref dlroexthlluabuiqdiip
```

Installed PWAs cache the previous bundle until fully reopened — after a deploy, swipe
the app away and relaunch (a tab refresh alone may not pick up the new service worker).
