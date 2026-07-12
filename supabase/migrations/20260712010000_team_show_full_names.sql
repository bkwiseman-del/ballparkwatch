-- =====================================================================
-- Per-team "show full names" opt-in (rollout plan ①, doc 1 §9 "full names = league/team opt-in").
--
-- The public viewer RPCs are anonymous, so ① floored EVERY name — including a team's OWN players
-- for its OWN people. Doc 1's model is: first-name-last-initial is the safe DEFAULT, and a team may
-- opt into showing full names to its viewers. This adds teams.show_full_names (default false = the
-- safe floor) and threads it through the public name chokepoint, so an opted-in team shows full
-- names on its viewer + public team page while other teams and the ghost/opponent side are unaffected.
--
-- public_player_name gains a p_full_ok arg. Priority per player: GHOST → number-only; else opted-in
-- → full name; else → floor. The server now emits the FINAL public string (the client renders it
-- verbatim — no client-side re-flooring, which would otherwise clobber an opted-in full name).
-- Additive + idempotent. Apply via the Supabase SQL editor / Management API.
-- =====================================================================

alter table bpw.teams
  add column if not exists show_full_names boolean not null default false;

-- Replace the 3-arg helper with a 4-arg one (drop first so there's no ambiguous overload).
drop function if exists bpw.public_player_name(text, text, boolean);
create or replace function bpw.public_player_name(p_name text, p_jersey text, p_ghost boolean, p_full_ok boolean)
returns text language sql immutable as $$
  select case
    when coalesce(p_ghost, false) then
      case
        when coalesce(btrim(p_jersey), '') <> '' then '#' || btrim(p_jersey)   -- number first
        when p_name is not null and btrim(p_name) <> ''
             and split_part(btrim(p_name), ' ', array_length(string_to_array(btrim(p_name), ' '), 1)) ~ '^[0-9]+$'
          then btrim(p_name)                                                   -- generic label kept
        else ''                                                                -- real name suppressed
      end
    when coalesce(p_full_ok, false) then coalesce(btrim(p_name), '')           -- team opted in: full name
    else bpw.names_down(p_name)                                               -- default: floor
  end;
$$;
revoke all on function bpw.public_player_name(text, text, boolean, boolean) from public;
grant execute on function bpw.public_player_name(text, text, boolean, boolean) to anon, authenticated, service_role;

-- lineup_json: thread the team's ghost + show_full_names flags.
create or replace function bpw.lineup_json(p_game_id uuid, p_team_id uuid)
returns jsonb language sql security definer set search_path = bpw, public stable as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', bpw.public_player_name(p.name, p.jersey_number, t.claim_status = 'ghost', coalesce(t.show_full_names, false)),
        'jersey', p.jersey_number,
        'pos', le.position
      ) order by le.batting_order
    ), '[]'::jsonb
  )
  from bpw.lineup_entries le
  join bpw.players p on p.id = le.player_id
  join bpw.teams   t on t.id = le.team_id
  where le.game_id = p_game_id and le.team_id = p_team_id;
$$;

-- get_public_events
create or replace function bpw.get_public_events(p_game_id uuid)
returns jsonb language sql security definer set search_path = bpw, public stable as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'seq', e.seq,
        'event_type', e.event_type,
        'inning', e.inning,
        'half', e.half,
        'batter_id', e.batter_id,
        'batter_name', bpw.public_player_name(p.name, p.jersey_number, t.claim_status = 'ghost', coalesce(t.show_full_names, false)),
        'payload', e.payload,
        'wall_clock_ts', e.wall_clock_ts
      ) order by e.seq
    ), '[]'::jsonb
  )
  from bpw.game_events e
  left join bpw.players p on p.id = e.batter_id
  left join bpw.teams   t on t.id = p.team_id
  where e.game_id = p_game_id;
$$;

-- get_public_game (players map)
create or replace function bpw.get_public_game(p_game_id uuid)
returns jsonb language sql security definer set search_path = bpw, public stable as $$
  select jsonb_build_object(
    'id', g.id,
    'status', g.status,
    'video_source', g.video_source,
    'video_config', coalesce(g.video_config, '{}'::jsonb),
    'stat_delay_ms', g.stat_delay_ms,
    'recap', g.recap,
    'scheduled_at', g.scheduled_at,
    'recording_path', g.recording_path,
    'recording_started_at', g.recording_started_at,
    'recording_mime', g.recording_mime,
    'recording_duration_ms', g.recording_duration_ms,
    'recording_segments', g.recording_segments,
    'cf_whep_url', g.cf_whep_url,
    'cf_hls_url', g.cf_hls_url,
    'cf_recording_uid', g.cf_recording_uid,
    'cf_customer_code', g.cf_customer_code,
    'ivs_playback_url', g.ivs_playback_url,
    'ivs_replay_url', g.ivs_replay_url,
    'ivs_replay_angles', g.ivs_replay_angles,
    'away', jsonb_build_object('name', away.name, 'code', away.code),
    'home', jsonb_build_object('name', home.name, 'code', home.code),
    'snapshot', coalesce(gs.snapshot, '{}'::jsonb),
    'lineups', jsonb_build_object(
      'away', bpw.lineup_json(g.id, g.away_team_id),
      'home', bpw.lineup_json(g.id, g.home_team_id)
    ),
    'players', coalesce((
      select jsonb_object_agg(p.id, jsonb_build_object(
        'name', bpw.public_player_name(p.name, p.jersey_number, t.claim_status = 'ghost', coalesce(t.show_full_names, false)),
        'jersey', p.jersey_number))
      from bpw.players p
      join bpw.teams t on t.id = p.team_id
      where p.team_id in (g.away_team_id, g.home_team_id)
    ), '{}'::jsonb),
    'sponsors', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'image', s.image_path, 'url', s.click_url)
             order by s.sort, s.created_at)
      from bpw.team_sponsors s
      where s.team_id in (g.away_team_id, g.home_team_id) and s.active and s.status = 'approved'
    ), '[]'::jsonb)
  )
  from bpw.games g
  join bpw.teams away on away.id = g.away_team_id
  join bpw.teams home on home.id = g.home_team_id
  left join bpw.game_state gs on gs.game_id = g.id
  where g.id = p_game_id
    and not exists (
      select 1 from bpw.teams tt
      where tt.id in (g.home_team_id, g.away_team_id)
        and tt.broadcast_audience = 'members'
        and not bpw.is_team_member(tt.id)
    );
$$;

-- get_public_team (public team page roster) — respect the same opt-in.
create or replace function bpw.get_public_team(p_slug text)
returns jsonb language sql security definer set search_path = bpw, public stable as $$
  select case when t.id is null then null else jsonb_build_object(
    'name', t.name,
    'city', t.city,
    'state', t.state,
    'sport', t.sport,
    'age_group', t.age_group,
    'discovery', t.discovery,
    'season', (select s.label from bpw.seasons s where s.id = t.season_id),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', bpw.public_player_name(p.name, p.jersey_number, false, coalesce(t.show_full_names, false)),
               'number', p.jersey_number)
             order by p.jersey_number nulls last, p.name)
      from bpw.players p where p.team_id = t.id and p.archived_at is null
    ), '[]'::jsonb),
    'record', (
      select jsonb_build_object(
        'gp', count(*), 'w', count(*) filter (where my > opp),
        'l', count(*) filter (where my < opp), 't', count(*) filter (where my = opp),
        'rf', coalesce(sum(my), 0), 'ra', coalesce(sum(opp), 0))
      from (
        select case when g.home_team_id = t.id then gs.home_score else gs.away_score end my,
               case when g.home_team_id = t.id then gs.away_score else gs.home_score end opp
        from bpw.games g join bpw.game_state gs on gs.game_id = g.id
        where g.status = 'final' and (g.home_team_id = t.id or g.away_team_id = t.id)
      ) r
    ),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'when', g.scheduled_at,
               'status', g.status,
               'home', (g.home_team_id = t.id),
               'opponent', case when g.home_team_id = t.id then away.name else home.name end,
               'my_score', case when g.status = 'final' then (case when g.home_team_id = t.id then gs.home_score else gs.away_score end) end,
               'opp_score', case when g.status = 'final' then (case when g.home_team_id = t.id then gs.away_score else gs.home_score end) end,
               'replay', (t.broadcast_audience = 'public' and g.recording_path is not null)
             ) order by g.scheduled_at desc nulls last, g.created_at desc)
      from bpw.games g
      join bpw.teams away on away.id = g.away_team_id
      join bpw.teams home on home.id = g.home_team_id
      left join bpw.game_state gs on gs.game_id = g.id
      where (g.home_team_id = t.id or g.away_team_id = t.id)
    ), '[]'::jsonb)
  ) end
  from (select * from bpw.teams where slug = p_slug and discovery in ('discoverable', 'public')) t;
$$;

grant execute on function bpw.lineup_json(uuid, uuid) to anon, authenticated;
grant execute on function bpw.get_public_events(uuid) to anon, authenticated;
grant execute on function bpw.get_public_game(uuid) to anon, authenticated;
grant execute on function bpw.get_public_team(text) to anon, authenticated;
