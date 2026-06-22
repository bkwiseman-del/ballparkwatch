# Ballpark Watch ⚾

Live baseball scoring & streaming for youth and amateur leagues. One parent scores
play-by-play; family watches a live video stream with a synchronized scorebug — or
just the stats, no video required. A browser-based PWA, built in the spirit of
GameChanger but around an **event-sourced** core: every pitch is an immutable event,
and the scorebug, box score, and (later) AI commentary are all projections of that log.

## Quick start

```bash
npm install
cp .env.example .env.local   # already populated locally with shared Supabase values
npm run dev                  # http://localhost:5173
```

Sign up / sign in, then create a team, add players, and create a game.

## Project layout

```
src/
  auth/         AuthProvider + RequireAuth route guard
  lib/          supabase client (bpw schema) + domain types
  routes/       Login · Setup · Score (Phase 1) · Watch (Phase 1)
supabase/
  migrations/   bpw schema, event-sourced model, ownership-based RLS
docs/           build plan + full design handoff (visual spec, product brief)
```

## Database setup

The app uses a dedicated **`bpw`** schema inside a shared Supabase project. To apply
the schema, paste [supabase/migrations/20260622000000_init.sql](supabase/migrations/20260622000000_init.sql)
into the Supabase **SQL editor** and run it, then add `bpw` to the project's
**exposed schemas** (Settings → API). See [CLAUDE.md](CLAUDE.md) for the full rationale.

## Status

Phase 0 (scaffolding) complete: auth, design tokens, route shells, schema, and a
working Setup screen. Phase 1 (scoring + live scorebug) is next. See the phased plan
in [docs/baseball-app-build-plan.md](docs/baseball-app-build-plan.md).
