-- =====================================================================
-- Part B / B0 increment 2 — org-owned SEASONS + DIVISIONS (rollout plan Part B, doc 2 §2).
--
-- Builds on B0.1 (organizations). Adds the next two levels of the league tree:
--   Organization → org_season → division → (team via teams.division_id).
--
-- Reconciliation: the existing bpw.seasons table is the GLOBAL calendar reference (year/term/label,
-- referenced by teams.season_id) and is LEFT UNTOUCHED. Doc 2's richer, org-owned Season is a NEW
-- table `org_seasons` (name/format/dates/status/ruleset). A team keeps its global season_id for
-- durable identity AND gains a nullable division_id for league placement — both optional, so
-- standalone teams are unaffected.
--
-- Division coordinator write-scoping (doc 2 §1) is DEFERRED to B0.3 (needs a division ref on the
-- grant); for now writes are org_admin-only. Rule profiles (innings, pitch-count table, keeps-score
-- flag, field requirements, tournament ruleset) live in the `rule_profile`/`ruleset` jsonb bags so
-- the schema stays lean. Additive + idempotent. Apply via the Supabase SQL editor.
-- =====================================================================

do $$ begin
  create type bpw.season_format as enum ('league', 'tournament');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bpw.org_season_status as enum ('setup', 'active', 'complete');
exception when duplicate_object then null; end $$;

-- ---- org_seasons (doc 2 "Season": belongs to Org, has Divisions) ---------------------------------
create table if not exists bpw.org_seasons (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references bpw.organizations (id) on delete cascade,
  name       text not null,                                   -- "Spring 2026 Rec"
  format     bpw.season_format not null default 'league',
  sport      text not null default 'baseball' check (sport in ('baseball', 'softball')),
  starts_on  date,
  ends_on    date,
  status     bpw.org_season_status not null default 'setup',
  ruleset    jsonb not null default '{}'::jsonb,              -- tournament format/guarantee/seeding/tiebreakers…
  created_at timestamptz not null default now()
);
create index if not exists org_seasons_org_idx on bpw.org_seasons (org_id);

-- ---- divisions (doc 2 "Division": belongs to Season, has Teams) -----------------------------------
create table if not exists bpw.divisions (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references bpw.org_seasons (id) on delete cascade,
  org_id       uuid not null references bpw.organizations (id) on delete cascade, -- denormalized for RLS
  name         text not null,                                 -- "10U", "12U-B"
  rule_profile jsonb not null default '{}'::jsonb,            -- innings/game-length/roster-size/pitch-count table/
                                                              --   mercy/keeps_score flag/field requirements
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists divisions_season_idx on bpw.divisions (season_id);
create index if not exists divisions_org_idx on bpw.divisions (org_id);

-- ---- team → division placement (NULLABLE; standalone/global-season teams unaffected) --------------
alter table bpw.teams
  add column if not exists division_id uuid references bpw.divisions (id);
create index if not exists teams_division_idx on bpw.teams (division_id);

-- ---- RLS: org members read; org admins write (coordinator scoping is B0.3) ------------------------
alter table bpw.org_seasons enable row level security;
alter table bpw.divisions   enable row level security;

drop policy if exists org_seasons_select on bpw.org_seasons;
create policy org_seasons_select on bpw.org_seasons for select using (bpw.is_org_member(org_id));
drop policy if exists org_seasons_write on bpw.org_seasons;
create policy org_seasons_write on bpw.org_seasons for all
  using (bpw.is_org_admin(org_id)) with check (bpw.is_org_admin(org_id));

drop policy if exists divisions_select on bpw.divisions;
create policy divisions_select on bpw.divisions for select using (bpw.is_org_member(org_id));
drop policy if exists divisions_write on bpw.divisions;
create policy divisions_write on bpw.divisions for all
  using (bpw.is_org_admin(org_id)) with check (bpw.is_org_admin(org_id));
