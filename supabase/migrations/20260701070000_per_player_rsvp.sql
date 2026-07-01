-- =====================================================================
-- Per-player attendance. Families link which player(s) are theirs, and RSVP is
-- recorded PER KID so a coach sees which players are coming (not which parent
-- account responded). We still "follow the whole team" for the feed/notifications;
-- this adds an optional player linkage on top for attendance.
--
-- Replaces the account-level rsvps table added earlier today (only test taps lost —
-- no production data). Apply via the Supabase SQL editor (shared schema; CLAUDE.md).
-- =====================================================================

-- ---------- who a family's kids are ----------
create table if not exists bpw.member_players (
  team_id    uuid not null references bpw.teams (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  player_id  uuid not null references bpw.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, player_id)
);
create index if not exists member_players_team_idx on bpw.member_players (team_id);
create index if not exists member_players_player_idx on bpw.member_players (player_id);

alter table bpw.member_players enable row level security;
revoke all on bpw.member_players from anon;

-- Members see the links (staff to manage, families to see their own).
drop policy if exists mp_read on bpw.member_players;
create policy mp_read on bpw.member_players for select using (bpw.is_team_member(team_id));
-- You manage your OWN links; staff can assign a kid to any parent.
drop policy if exists mp_write on bpw.member_players;
create policy mp_write on bpw.member_players for all
  using (bpw.is_team_member(team_id) and (user_id = auth.uid() or bpw.is_team_staff(team_id)))
  with check (bpw.is_team_member(team_id) and (user_id = auth.uid() or bpw.is_team_staff(team_id)));

-- Can the caller set THIS player's attendance? Staff (marking the book) or a family
-- who has linked that kid.
create or replace function bpw.manages_player(p_team_id uuid, p_player_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select bpw.is_team_staff(p_team_id)
      or exists (select 1 from bpw.member_players where user_id = auth.uid() and player_id = p_player_id);
$$;
revoke all on function bpw.manages_player(uuid, uuid) from public, anon;
grant execute on function bpw.manages_player(uuid, uuid) to authenticated;

-- ---------- attendance, keyed by player ----------
drop table if exists bpw.rsvps cascade;
create table bpw.rsvps (
  team_id     uuid not null references bpw.teams (id) on delete cascade,
  target_type text not null check (target_type in ('game', 'event')),
  target_id   uuid not null,       -- a games.id or a team_events.id
  player_id   uuid not null references bpw.players (id) on delete cascade,
  status      text not null check (status in ('going', 'maybe', 'not')),
  set_by      uuid not null default auth.uid() references auth.users (id),
  updated_at  timestamptz not null default now(),
  primary key (target_type, target_id, player_id)
);
create index if not exists rsvps_target_idx on bpw.rsvps (team_id, target_type, target_id);

alter table bpw.rsvps enable row level security;
revoke all on bpw.rsvps from anon;

-- Members see their team's attendance (counts). Named per-kid list is staff-only (rsvp_list).
drop policy if exists rsvps_read on bpw.rsvps;
create policy rsvps_read on bpw.rsvps for select using (bpw.is_team_member(team_id));
-- You set attendance only for players you manage (your kids) — or if you're staff.
drop policy if exists rsvps_write on bpw.rsvps;
create policy rsvps_write on bpw.rsvps for all
  using (bpw.manages_player(team_id, player_id))
  with check (bpw.manages_player(team_id, player_id));

-- ---------- feed: going_count = distinct players marked going ----------
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
        'type', 'game', 'id', g.id, 'starts_at', g.scheduled_at, 'status', g.status,
        'location', g.location, 'slug', g.slug,
        'home', home.name, 'away', away.name,
        'home_id', g.home_team_id, 'away_id', g.away_team_id,
        'video_source', g.video_source, 'recording_started_at', g.recording_started_at,
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
        'type', e.kind, 'id', e.id, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
        'title', e.title, 'location', e.location, 'notes', e.notes,
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

-- ---------- staff roster: who's coming, by PLAYER ----------
drop function if exists bpw.rsvp_list(uuid, text, uuid);
create or replace function bpw.rsvp_list(p_team_id uuid, p_target_type text, p_target_id uuid)
returns table (player_id uuid, name text, jersey text, status text)
language sql security definer stable set search_path = bpw, public as $$
  select r.player_id, p.name, p.jersey_number, r.status
  from bpw.rsvps r
  join bpw.players p on p.id = r.player_id
  where r.team_id = p_team_id
    and r.target_type = p_target_type
    and r.target_id = p_target_id
    and bpw.is_team_staff(p_team_id)
  order by case r.status when 'going' then 0 when 'maybe' then 1 else 2 end, p.name;
$$;
revoke all on function bpw.rsvp_list(uuid, text, uuid) from public, anon;
grant execute on function bpw.rsvp_list(uuid, text, uuid) to authenticated;
