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
  In-play resolver includes the **infield-fly rule** (auto-gated to when it can apply).
  Plus a **Scoreboard mode** that is a *pure* scoreboard — runs/hits/outs/count only, **no
  baserunners, no batting order, no lineup** (the count buttons just manage balls/strikes; a walk
  clears the count, a strikeout is an out). The public viewer forces the scoreboard layout for these
  games.
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
  organ/charge stingers, plus a **per-batter day line** on 2nd+ plate appearances ("Carson S. is
  one for two today, with a double"). Video audio is **independent** of commentary (see below).
- **Phase 4 — AI lineup scan + recap** ✅ — Claude OCR of a lineup photo; Claude-written
  game recap on the final screen, built from the saved event log.
- **Phase 5 — Voice scoring** ⬜ — stretch; not started.

See the phased plan in [docs/baseball-app-build-plan.md](docs/baseball-app-build-plan.md),
the unified [docs/bandbox-plan.md](docs/bandbox-plan.md), and the IVS video architecture in
[docs/ivs-migration-plan.md](docs/ivs-migration-plan.md).

## Known limitations & open work (as of July 2026)

**Streaming / recording (Amazon IVS) — live and validated:**

- **Camera + phone both live on IVS**: sub-second phone publish + view, external-camera HLS + synced
  scorebug, composition→S3 recording, CloudFront replay with a branded player. The old Cloudflare
  Stream path + the DIY GStreamer recorder (Railway) are **deleted**. Recording/channel encoder is
  now **720p @ 5 Mbps** (was 2.5 — the old bitrate looked soft).
- **Live-video controls** (`LiveVideoControls`) on the phone + multi-angle WebRTC viewers:
  **mute / fullscreen / picture-in-picture**. The video's audio is **independent of the AI-commentary
  toggle** — mute commentary and keep game audio, or either, or neither. (Casting/Chromecast/AirPlay
  is intentionally omitted — not reliable for live WebRTC MediaStreams.)
- **Live viewer count** ("👁 N", flat icon) on the scorer + public page during live games, via
  **Supabase Realtime presence** (works for all game types incl. stats-only). This replaced the old
  peer-to-peer count, which died in the IVS migration (viewers connect to Amazon now, not the
  broadcaster). NOTE: this is DISPLAY only — the hard 5-viewer free cap must be enforced server-side
  at `viewer-token` mint (count real IVS stage subscribers); that enforcement is **not yet wired**.
- **External camera (RTMP) reality — important:** the scorer's setup **preview** is a WebRTC subscribe
  to the stage; the **live stream + recording** come from the server-side **composition**. These are
  different paths, so *a good preview does not prove the stream works.* RTMP is fixed-bitrate and can't
  adapt, so on a thin uplink (e.g. the scoring phone's **cellular hotspot** at a crowded park) the
  video starves → **black stream/recording while audio keeps flowing** (audio is tiny) and the
  connection stays "up." This is a universal RTMP/uplink constraint (GameChanger hits it too and just
  tells users to lower bitrate / use a better connection). **Gap to close:** our "camera live" health
  signal only knows the participant is *publishing* (audio keeps it published), so it can falsely show
  green. A true **ingest-video health check** (read IVS ingest video bitrate/framerate → warn "camera
  connected, but no video is reaching the stream") is planned — it'd put us ahead of GC here.
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

**Scorer reliability — recently fixed:** the "reload/app-switch dropped a run or jumped back an
inning" bug is fixed with a **monotonic self-healing resync** — on focus / tab-visible / a slow
interval / ~1.5s after load, the scorer reconciles against the immutable event log, **adopts** the
server state when it's behind, **re-persists** when it's ahead of the viewer snapshot, and **never
moves backward** (a stale read can't cause a regression, and any regression self-corrects in
seconds). A mutation guard keeps it from racing an in-flight score/undo. Earlier fixes remain:
recovery keyed on `game_start` + `game_state` reconcile, reachable inning-break "End game",
`set_batter` for guessed opposing orders.

**Privacy / name-safety — now server-enforced** (built as part of the org/privacy rework): the public
game RPCs floor names **on the server** via `bpw.public_player_name` — ghost/opponent players →
jersey number (or a kept generic label, else suppressed); a team that opts in (`teams.show_full_names`)
→ full names to its viewers; otherwise the floor is **first name + last initial** ("Carson S.").
Client renders the server string verbatim (no client re-flooring). Open item: a requested per-team
convention of **first-initial + last name** ("C. Siefferman") for a team's own players — a new format
not yet in the chokepoint. (Field-diamond chips were separately fixed to show the **surname**, not the
first name.)

**Also up next:** pitch-count alerts, offline resilience, season stats, viewer notifications, and
migrating `bpw` to its own Supabase project once validated.

**Strategy note:** Amazon IVS won on capabilities Cloudflare fundamentally couldn't do — recording
the WHIP feed, no-pre-game trimming, and timed-metadata scorebug sync — all proven in a spike before
committing. Cost stays aligned with "family never pays, sponsor-funded": **replays are cheap S3 +
CloudFront egress, NOT per-viewer live billing**; only the sub-second WebRTC *live* window bills
per-viewer (~$0.072/participant-hr), bounded by the dormant 5-viewer free cap. ~$2–12 live per game.

## Deploy

The PWA **auto-deploys to Vercel on push to `main`** — the repo has a Vercel GitHub integration
(production branch `main`), so every push builds and deploys to production (aliased to bandbox.tv).
No manual step. A manual production deploy, if ever needed, is `npx vercel --prod --yes`.
Supabase Edge Functions deploy separately:

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy <name> --no-verify-jwt \
  --project-ref dlroexthlluabuiqdiip
```

Installed PWAs cache the previous bundle until fully reopened — after a deploy, swipe
the app away and relaunch (a tab refresh alone may not pick up the new service worker).
