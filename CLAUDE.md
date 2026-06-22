# Ballpark Watch — project guide

Live baseball scoring + streaming PWA for youth/amateur leagues (think GameChanger).
One parent **scores** play-by-play; family **watches** a live video stream with a
synced scorebug via a no-account share link. Video is optional — it also works
stats-only. Started as a personal tool; **built to grow into a sellable product**.

## Architecture (read this first)
- **Event-sourced.** `bpw.game_events` is the immutable source of truth. The live
  score/count/box score are projections. `bpw.game_state` is a cached one-row-per-game
  snapshot viewers subscribe to via Realtime. Video is an orthogonal optional layer —
  it never touches the data model. Every AI feature is a producer (writes events) or
  consumer (reads the log).
- Full spec: [docs/baseball-app-build-plan.md](docs/baseball-app-build-plan.md).
  Design system + screens: [docs/design_handoff_ballpark_watch/README.md](docs/design_handoff_ballpark_watch/README.md).

## Stack
React + Vite + TypeScript PWA (`vite-plugin-pwa`) · Tailwind · React Router ·
Supabase (Postgres + Auth + Realtime + Storage + Edge Functions). Later: Cloudflare
Stream (video), ElevenLabs (TTS), Anthropic/Claude (lineup OCR, recap, commentary).
**All third-party secrets live only in Edge Functions, never in the client.**

## Database — IMPORTANT
- Shares **one** Supabase project (`dlroexthlluabuiqdiip`) with `string-art` and
  `three-wise-prints` to save cost. Isolated in a dedicated **`bpw`** Postgres schema.
  Never use `public`. Storage paths prefixed `bpw/`.
- Supabase client is created with `{ db: { schema: 'bpw' } }` (see
  [src/lib/supabase.ts](src/lib/supabase.ts)).
- **Manual step:** `bpw` must be in the project's PostgREST exposed-schemas list
  (Dashboard → Settings → API → Exposed schemas: `public,graphql_public,twp,bpw`),
  or every query 404s with `PGRST106`.
- Auth pool is **project-wide** (shared across the 3 apps). So RLS is
  **ownership-based** (`owner_id = auth.uid()`), never "any authenticated user".
  Children inherit ownership through their parent (see the `bpw.owns_game()` helper).
- Apply migrations via the **Supabase SQL editor** (paste the file), not
  `supabase db push` — the migration-history table is shared with the other apps.
- Plan: move to its own Supabase project once validated. The self-contained `bpw`
  schema makes that a clean dump/restore.

## Design language — "vintage athletic, rendered flat"
Cream / ink-navy / barn-red / board-green / gold. Fonts: Alfa Slab One (display),
Saira Condensed (athletic labels/numerals), Archivo (data). **Hard corners
(radius 0) everywhere, no shadows/gradients** — the one allowed shadow is a hard
6px offset (`shadow-hard`). Tokens live in [tailwind.config.ts](tailwind.config.ts).
Light = cream-and-ink (daytime); dark = night-game scoreboard (default; `<html class="dark">`).

## Routes
- `/setup` — teams, rosters, games (auth required). Phase 0: functional CRUD.
- `/score/:gameId` — scoring cockpit (auth required). Phase 1.
- `/watch/:gameId` — public viewer, reached via share link (no account). Phase 1.

## Share links
Domain is **ballparkwatch.live** (owned). Links: `ballparkwatch.live/<slug>`.
(The design spec's `bpw.live` is a placeholder — use the real domain.)

## Build phases (build top-to-bottom; each has an acceptance test)
0. **Scaffolding** ✅ — sign in, create team/players, create a game.
1. Scoring + live scorebug, no video (the spine — first real milestone).
2. Video layer (camera/YouTube, then phone WHIP).
3. AI voice commentary. 4. AI lineup scan + recap. 5. Voice scoring (stretch).

## Dev
```
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
npm run typecheck
```
`.env.local` (gitignored) holds the shared client-safe `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY`. Service-role / Cloudflare / ElevenLabs / Anthropic keys
are Edge-Function-only.
