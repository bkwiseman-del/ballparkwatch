-- =====================================================================
-- Part A / ③ ghost opponents — NUMBER-ONLY public identity for ghost-team players
-- (rollout plan ③, doc 1 §9 "render the ghost side number-only on all public surfaces,
-- regardless of what the scorer types locally").
--
-- Un-consented opponent kids must never appear by name publicly. A ghost team is a team with
-- claim_status='ghost'. This extends the public RPCs so that a player belonging to a ghost team
-- returns an EMPTY name (the client falls back to the jersey → "#24"); real teams keep the
-- first-name+last-initial floor from names_down (20260711200000). get_public_events also gains a
-- batter_jersey field so play-by-play can show the number for a suppressed ghost batter.
--
-- Only the name spots change; every other field/join/visibility gate is preserved verbatim from the
-- live definitions. No existing team is a ghost, so this is inert until the first ghost is created
-- (additive + idempotent). Apply via the Supabase SQL editor / Management API.
-- =====================================================================

-- lineup_json: suppress ghost-team names (join the team to read claim_status).
create or replace function bpw.lineup_json(p_game_id uuid, p_team_id uuid)
returns jsonb language sql security definer set search_path = bpw, public stable as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', case when t.claim_status = 'ghost' then '' else bpw.names_down(p.name) end,
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

-- get_public_events: suppress ghost batter names; add batter_jersey for the client's number fallback.
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
        'batter_name', case when t.claim_status = 'ghost' then '' else bpw.names_down(p.name) end,
        'batter_jersey', p.jersey_number,
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

-- get_public_game: suppress ghost-team names in the players map (join the team). Body otherwise
-- verbatim from the live definition (incl. names_down floor + broadcast_audience visibility gate).
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
        'name', case when t.claim_status = 'ghost' then '' else bpw.names_down(p.name) end,
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

grant execute on function bpw.lineup_json(uuid, uuid) to anon, authenticated;
grant execute on function bpw.get_public_events(uuid) to anon, authenticated;
grant execute on function bpw.get_public_game(uuid) to anon, authenticated;
