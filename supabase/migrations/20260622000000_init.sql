-- =====================================================================
-- Ballpark Watch — initial schema
-- Lives in the dedicated `bpw` schema (shared Supabase project; isolated
-- from string-art/three-wise-prints). Event-sourced: game_events is the
-- source of truth; game_state is a cached projection for instant viewer
-- updates via Realtime.
--
-- Auth pool is project-wide, so RLS is OWNERSHIP-BASED (owner_id = auth.uid()),
-- never "any authenticated user". Children inherit ownership via their parent.
--
-- AFTER APPLYING: add `bpw` to the project's PostgREST exposed-schemas list
-- (Dashboard → Project Settings → API → Exposed schemas) or REST 404s w/ PGRST106.
-- =====================================================================

create schema if not exists bpw;

grant usage on schema bpw to anon, authenticated;
-- New tables inherit privileges so we don't re-grant per object.
alter default privileges in schema bpw grant all on tables to authenticated;
alter default privileges in schema bpw grant select on tables to anon;
alter default privileges in schema bpw grant all on sequences to authenticated;

-- ---------- Enums ----------
do $$ begin
  create type bpw.game_status as enum ('scheduled', 'live', 'final');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bpw.video_source as enum
    ('none', 'phone_whip', 'camera_rtmp', 'youtube', 'cloudflare_hls');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bpw.half as enum ('top', 'bottom');
exception when duplicate_object then null; end $$;

-- ---------- Core tables ----------
create table if not exists bpw.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  season text,
  created_at timestamptz not null default now()
);
create index if not exists teams_owner_idx on bpw.teams (owner_id);

create table if not exists bpw.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references bpw.teams (id) on delete cascade,
  name text not null,
  jersey_number text,
  default_position text,
  bats text check (bats in ('L', 'R', 'S')),
  throws text check (throws in ('L', 'R')),
  created_at timestamptz not null default now()
);
create index if not exists players_team_idx on bpw.players (team_id);

create table if not exists bpw.games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  home_team_id uuid not null references bpw.teams (id),
  away_team_id uuid not null references bpw.teams (id),
  scheduled_at timestamptz,
  status bpw.game_status not null default 'scheduled',
  video_source bpw.video_source not null default 'none',
  video_config jsonb not null default '{}'::jsonb,
  stat_delay_ms int not null default 0,
  slug text not null unique,
  -- Unguessable token for the no-account viewer link.
  share_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
create index if not exists games_owner_idx on bpw.games (owner_id);

create table if not exists bpw.lineup_entries (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references bpw.games (id) on delete cascade,
  team_id uuid not null references bpw.teams (id) on delete cascade,
  player_id uuid not null references bpw.players (id) on delete cascade,
  batting_order int,
  position text,
  is_starter boolean not null default true
);
create index if not exists lineup_game_idx on bpw.lineup_entries (game_id);

-- The source of truth: an immutable, ordered log of everything that happens.
create table if not exists bpw.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references bpw.games (id) on delete cascade,
  seq int not null,                 -- monotonic per game
  wall_clock_ts timestamptz not null default now(),  -- for delay/sync math
  inning int,
  half bpw.half,
  event_type text not null,         -- pitch_ball, single, strikeout, inning_change, ...
  batter_id uuid references bpw.players (id),
  pitcher_id uuid references bpw.players (id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (game_id, seq)
);
create index if not exists game_events_game_seq_idx on bpw.game_events (game_id, seq);

-- Cached projection: ONE row per game, upserted as events arrive. Viewers
-- subscribe to this for instant scorebug updates without replaying the log.
create table if not exists bpw.game_state (
  game_id uuid primary key references bpw.games (id) on delete cascade,
  inning int not null default 1,
  half bpw.half not null default 'top',
  outs int not null default 0,
  balls int not null default 0,
  strikes int not null default 0,
  home_score int not null default 0,
  away_score int not null default 0,
  runner_first uuid references bpw.players (id),
  runner_second uuid references bpw.players (id),
  runner_third uuid references bpw.players (id),
  current_batter_id uuid references bpw.players (id),
  current_pitcher_id uuid references bpw.players (id),
  updated_at timestamptz not null default now()
);

-- Optional AI caches (populated in later phases).
create table if not exists bpw.commentary_cache (
  id uuid primary key default gen_random_uuid(),
  game_event_id uuid not null references bpw.game_events (id) on delete cascade,
  text text not null,
  audio_url text,
  created_at timestamptz not null default now()
);

create table if not exists bpw.recaps (
  game_id uuid primary key references bpw.games (id) on delete cascade,
  body_text text not null,
  generated_at timestamptz not null default now()
);

-- ---------- Row Level Security ----------
alter table bpw.teams enable row level security;
alter table bpw.players enable row level security;
alter table bpw.games enable row level security;
alter table bpw.lineup_entries enable row level security;
alter table bpw.game_events enable row level security;
alter table bpw.game_state enable row level security;
alter table bpw.commentary_cache enable row level security;
alter table bpw.recaps enable row level security;

-- Helper: does the current user own this game?
create or replace function bpw.owns_game(p_game_id uuid)
returns boolean
language sql
security definer
set search_path = bpw, public
stable
as $$
  select exists (
    select 1 from bpw.games g
    where g.id = p_game_id and g.owner_id = auth.uid()
  );
$$;

-- teams: owner only
drop policy if exists teams_owner_all on bpw.teams;
create policy teams_owner_all on bpw.teams
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- players: via team ownership
drop policy if exists players_owner_all on bpw.players;
create policy players_owner_all on bpw.players
  for all using (
    exists (select 1 from bpw.teams t where t.id = players.team_id and t.owner_id = auth.uid())
  ) with check (
    exists (select 1 from bpw.teams t where t.id = players.team_id and t.owner_id = auth.uid())
  );

-- games: owner only
drop policy if exists games_owner_all on bpw.games;
create policy games_owner_all on bpw.games
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- lineup_entries / game_events / game_state / commentary / recaps: via game ownership
drop policy if exists lineup_owner_all on bpw.lineup_entries;
create policy lineup_owner_all on bpw.lineup_entries
  for all using (bpw.owns_game(game_id)) with check (bpw.owns_game(game_id));

drop policy if exists events_owner_all on bpw.game_events;
create policy events_owner_all on bpw.game_events
  for all using (bpw.owns_game(game_id)) with check (bpw.owns_game(game_id));

drop policy if exists state_owner_all on bpw.game_state;
create policy state_owner_all on bpw.game_state
  for all using (bpw.owns_game(game_id)) with check (bpw.owns_game(game_id));

drop policy if exists commentary_owner_all on bpw.commentary_cache;
create policy commentary_owner_all on bpw.commentary_cache
  for all using (
    exists (
      select 1 from bpw.game_events e
      where e.id = commentary_cache.game_event_id and bpw.owns_game(e.game_id)
    )
  ) with check (
    exists (
      select 1 from bpw.game_events e
      where e.id = commentary_cache.game_event_id and bpw.owns_game(e.game_id)
    )
  );

drop policy if exists recaps_owner_all on bpw.recaps;
create policy recaps_owner_all on bpw.recaps
  for all using (bpw.owns_game(game_id)) with check (bpw.owns_game(game_id));

-- NOTE: public (no-account) viewer reads by share_token are added in Phase 1
-- via SECURITY DEFINER RPCs (e.g. bpw.get_public_game(token)) so anon can read a
-- single game's state/events without broad SELECT grants. Not needed for Phase 0.
