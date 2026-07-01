-- =====================================================================
-- RSVP — families (and staff) mark going / maybe / can't for a game or practice.
-- Part of the family epic. team_upcoming() is extended to carry the caller's own
-- RSVP and a live "going" count per item, scoped to the followed team.
--
-- NON-DESTRUCTIVE: new table + REPLACE of team_upcoming (adds two fields per item,
-- nothing removed). Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
-- =====================================================================

create table if not exists bpw.rsvps (
  user_id     uuid not null references auth.users (id) on delete cascade,
  team_id     uuid not null references bpw.teams (id) on delete cascade,
  target_type text not null check (target_type in ('game', 'event')),
  target_id   uuid not null,       -- a games.id or a team_events.id (polymorphic)
  status      text not null check (status in ('going', 'maybe', 'not')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index if not exists rsvps_target_idx on bpw.rsvps (team_id, target_type, target_id);

alter table bpw.rsvps enable row level security;
revoke all on bpw.rsvps from anon;

-- Team members see their team's RSVPs (counts + who's coming).
drop policy if exists rsvps_read on bpw.rsvps;
create policy rsvps_read on bpw.rsvps for select using (bpw.is_team_member(team_id));

-- You set only your OWN RSVP, and only on a team you belong to.
drop policy if exists rsvps_write on bpw.rsvps;
create policy rsvps_write on bpw.rsvps for all
  using (user_id = auth.uid() and bpw.is_team_member(team_id))
  with check (user_id = auth.uid() and bpw.is_team_member(team_id));

-- Extend the unified feed with my_rsvp + going_count (scoped to this team).
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
        'recording_started_at', g.recording_started_at,
        'my_rsvp', (select r.status from bpw.rsvps r
                    where r.user_id = auth.uid() and r.team_id = p_team_id
                      and r.target_type = 'game' and r.target_id = g.id),
        'going_count', (select count(*) from bpw.rsvps r
                        where r.team_id = p_team_id and r.target_type = 'game'
                          and r.target_id = g.id and r.status = 'going')
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
        'notes', e.notes,
        'my_rsvp', (select r.status from bpw.rsvps r
                    where r.user_id = auth.uid() and r.team_id = p_team_id
                      and r.target_type = 'event' and r.target_id = e.id),
        'going_count', (select count(*) from bpw.rsvps r
                        where r.team_id = p_team_id and r.target_type = 'event'
                          and r.target_id = e.id and r.status = 'going')
      )
      from bpw.team_events e
      where e.team_id = p_team_id
    ) s
  );
end $$;
revoke all on function bpw.team_upcoming(uuid) from public, anon;
grant execute on function bpw.team_upcoming(uuid) to authenticated;
