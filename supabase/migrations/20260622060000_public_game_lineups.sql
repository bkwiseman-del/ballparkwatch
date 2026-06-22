-- Viewer needs lineups to show the current batter / on-deck / pitcher with
-- jersey numbers. Extend get_public_game with ordered lineups per team.

create or replace function bpw.lineup_json(p_game_id uuid, p_team_id uuid)
returns jsonb
language sql
security definer
set search_path = bpw, public
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', p.name, 'jersey', p.jersey_number, 'pos', le.position)
      order by le.batting_order
    ),
    '[]'::jsonb
  )
  from bpw.lineup_entries le
  join bpw.players p on p.id = le.player_id
  where le.game_id = p_game_id and le.team_id = p_team_id;
$$;

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
    'stat_delay_ms', g.stat_delay_ms,
    'scheduled_at', g.scheduled_at,
    'away', jsonb_build_object('name', away.name, 'code', away.code),
    'home', jsonb_build_object('name', home.name, 'code', home.code),
    'snapshot', coalesce(gs.snapshot, '{}'::jsonb),
    'lineups', jsonb_build_object(
      'away', bpw.lineup_json(g.id, g.away_team_id),
      'home', bpw.lineup_json(g.id, g.home_team_id)
    )
  )
  from bpw.games g
  join bpw.teams away on away.id = g.away_team_id
  join bpw.teams home on home.id = g.home_team_id
  left join bpw.game_state gs on gs.game_id = g.id
  where g.id = p_game_id;
$$;

grant execute on function bpw.lineup_json(uuid, uuid) to anon, authenticated;
grant execute on function bpw.get_public_game(uuid) to anon, authenticated;
