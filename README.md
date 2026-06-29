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
- **Phase 2 — Video layer** ✅ — YouTube embed and phone-to-phone WebRTC capture
  (`/broadcast`, WHIP-style over Supabase signaling) with remote terminate and a
  latency-synced scorebug. Cloudflare Stream is the future managed path.
- **Phase 3 — AI voice commentary** ✅ — GameChanger-style audio: synced sound FX,
  ElevenLabs play-by-play (content-hash cached to cut cost), stadium reverb, crowd bed,
  organ/charge stingers.
- **Phase 4 — AI lineup scan + recap** ✅ — Claude OCR of a lineup photo; Claude-written
  game recap on the final screen, built from the saved event log.
- **Phase 5 — Voice scoring** ⬜ — stretch; not started.

Up next: hardening for sale (pitch-count alerts, offline resilience, season stats,
viewer notifications) and migrating `bpw` to its own Supabase project once validated.
See the phased plan in [docs/baseball-app-build-plan.md](docs/baseball-app-build-plan.md)
and [docs/product-strategy.md](docs/product-strategy.md).

## Deploy

The PWA deploys to **Vercel** on push to `main` (production). Supabase Edge Functions
deploy separately:

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy <name> --no-verify-jwt \
  --project-ref dlroexthlluabuiqdiip
```

Installed PWAs cache the previous bundle until fully reopened — after a deploy, swipe
the app away and relaunch (a tab refresh alone may not pick up the new service worker).
</content>
</invoke>
