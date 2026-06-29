-- Replay support: expose the recording on the game, and a per-event wall_clock_ts,
-- so the viewer can play the recording back with the scorebug + AI commentary synced
-- (each event fires at wall_clock_ts − recording_started_at into the video).

create or replace function bpw.get_public_game(p_game_id uuid)
returns jsonb
language sql
security definer
set search_path = bpw, public
stable
as $$
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
    'away', jsonb_build_object('name', away.name, 'code', away.code),
    'home', jsonb_build_object('name', home.name, 'code', home.code),
    'snapshot', coalesce(gs.snapshot, '{}'::jsonb),
    'lineups', jsonb_build_object(
      'away', bpw.lineup_json(g.id, g.away_team_id),
      'home', bpw.lineup_json(g.id, g.home_team_id)
    ),
    'players', coalesce((
      select jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'jersey', p.jersey_number))
      from bpw.players p
      where p.team_id in (g.away_team_id, g.home_team_id)
    ), '{}'::jsonb)
  )
  from bpw.games g
  join bpw.teams away on away.id = g.away_team_id
  join bpw.teams home on home.id = g.home_team_id
  left join bpw.game_state gs on gs.game_id = g.id
  where g.id = p_game_id;
$$;

grant execute on function bpw.get_public_game(uuid) to anon, authenticated;

create or replace function bpw.get_public_events(p_game_id uuid)
returns jsonb
language sql
security definer
set search_path = bpw, public
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'seq', e.seq,
        'event_type', e.event_type,
        'inning', e.inning,
        'half', e.half,
        'batter_id', e.batter_id,
        'batter_name', p.name,
        'payload', e.payload,
        'wall_clock_ts', e.wall_clock_ts
      ) order by e.seq
    ),
    '[]'::jsonb
  )
  from bpw.game_events e
  left join bpw.players p on p.id = e.batter_id
  where e.game_id = p_game_id;
$$;

grant execute on function bpw.get_public_events(uuid) to anon, authenticated;
