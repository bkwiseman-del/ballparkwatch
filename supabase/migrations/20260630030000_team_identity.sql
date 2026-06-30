-- =====================================================================
-- Durable-team identity & discovery metadata (plan §2 "Team & season identity", §8).
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
--
-- ADDITIVE + non-destructive: new columns on teams (all defaulted/nullable) + a
-- canonical seasons reference table + a per-team slug. Does NOT touch games/players
-- or re-point anything — the invasive "games attach to a team_season" reshape is a
-- separate, deliberate pass. This just lays the durable-team groundwork the team page
-- and discovery filters need.
-- =====================================================================

do $$ begin create type bpw.team_sport     as enum ('baseball', 'softball'); exception when duplicate_object then null; end $$;
do $$ begin create type bpw.team_discovery as enum ('private', 'discoverable', 'public'); exception when duplicate_object then null; end $$;
do $$ begin create type bpw.season_term    as enum ('spring', 'summer', 'fall', 'winter'); exception when duplicate_object then null; end $$;

-- Canonical seasons (controlled vocabulary, so directory filters actually work).
create table if not exists bpw.seasons (
  id    uuid primary key default gen_random_uuid(),
  year  int not null,
  term  bpw.season_term not null,
  label text not null,
  unique (year, term)
);
alter table bpw.seasons enable row level security;
drop policy if exists seasons_read on bpw.seasons;
create policy seasons_read on bpw.seasons for select using (true);  -- reference data; seeded below

insert into bpw.seasons (year, term, label)
select y, t::bpw.season_term, initcap(t) || ' ' || y
from generate_series(2025, 2027) y, unnest(array['spring', 'summer', 'fall', 'winter']) t
on conflict (year, term) do nothing;

-- Durable team metadata.
alter table bpw.teams
  add column if not exists sport        bpw.team_sport     not null default 'baseball',
  add column if not exists city         text,
  add column if not exists state        text,                       -- 2-letter; validated in app
  add column if not exists country      text not null default 'US',
  add column if not exists age_group    text,                       -- 8U…HS-V
  add column if not exists level        text,                       -- rec / travel / school
  add column if not exists birth_year   int,                        -- stable cohort anchor (travel)
  add column if not exists season_id    uuid references bpw.seasons (id),
  add column if not exists slug         text,
  add column if not exists discovery    bpw.team_discovery not null default 'private',  -- beta: opt-in; launch default flips to 'discoverable' (§8)
  add column if not exists claim_status text not null default 'claimed';

-- Slug: backfill existing, auto-set on insert.
update bpw.teams
   set slug = lower(regexp_replace(coalesce(name, 'team'), '[^a-z0-9]+', '-', 'gi'))
              || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
 where slug is null;
create unique index if not exists teams_slug_idx on bpw.teams (slug);

create or replace function bpw.set_team_slug()
returns trigger language plpgsql security definer set search_path = bpw, public as $$
begin
  if new.slug is null then
    new.slug := lower(regexp_replace(coalesce(new.name, 'team'), '[^a-z0-9]+', '-', 'gi'))
                || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;
  return new;
end $$;
drop trigger if exists teams_set_slug on bpw.teams;
create trigger teams_set_slug before insert on bpw.teams
  for each row execute function bpw.set_team_slug();
