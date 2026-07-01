-- =====================================================================
-- Schedule — Increment 4 of the family-member epic.
-- team_events holds practices and non-game calendar items (games stay in
-- bpw.games). team_upcoming() merges games + events into one member-visible
-- feed that powers the team schedule and the family "following" home.
--
-- NON-DESTRUCTIVE: new table + one RPC. Nothing else touched.
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
-- =====================================================================

create table if not exists bpw.team_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references bpw.teams (id) on delete cascade,
  kind       text not null default 'practice' check (kind in ('practice', 'event')),
  title      text,
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  location   text,
  notes      text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists team_events_team_idx on bpw.team_events (team_id, starts_at);

alter table bpw.team_events enable row level security;
-- Internal to the team (practice location/time isn't public). anon never reads.
revoke all on bpw.team_events from anon;

drop policy if exists team_events_read on bpw.team_events;
create policy team_events_read on bpw.team_events for select using (bpw.is_team_member(team_id));

drop policy if exists team_events_write on bpw.team_events;
create policy team_events_write on bpw.team_events for all
  using (bpw.can_manage_team(team_id)) with check (bpw.can_manage_team(team_id));

-- Unified upcoming feed: this team's games (home or away) + its practices/events,
-- as one time-ordered jsonb array. Member-gated (family included).
create or replace function bpw.team_upcoming(p_team_id uuid)
returns jsonb language plpgsql security definer stable set search_path = bpw, public as $$
begin
  if not bpw.is_team_member(p_team_id) then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(item order by sort_at asc nulls last), '[]'::jsonb)
    from (
      select g.scheduled_at as sort_at, jsonb_build_object(
        'type', 'game',
        'id', g.id,
        'starts_at', g.scheduled_at,
        'status', g.status,
        'location', g.location,
        'slug', g.slug,
        'home', home.name, 'away', away.name,
        'home_id', g.home_team_id, 'away_id', g.away_team_id,
        'video_source', g.video_source,
        'recording_started_at', g.recording_started_at
      ) as item
      from bpw.games g
      join bpw.teams home on home.id = g.home_team_id
      join bpw.teams away on away.id = g.away_team_id
      where g.home_team_id = p_team_id or g.away_team_id = p_team_id

      union all

      select e.starts_at as sort_at, jsonb_build_object(
        'type', e.kind,
        'id', e.id,
        'starts_at', e.starts_at,
        'ends_at', e.ends_at,
        'title', e.title,
        'location', e.location,
        'notes', e.notes
      )
      from bpw.team_events e
      where e.team_id = p_team_id
    ) s
  );
end $$;
revoke all on function bpw.team_upcoming(uuid) from public, anon;
grant execute on function bpw.team_upcoming(uuid) to authenticated;
