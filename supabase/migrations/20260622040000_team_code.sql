-- Editable 3-letter team code for the scorebug / line score (overrides the
-- auto-derived abbreviation when set).
alter table bpw.teams
  add column if not exists code text;

-- Surface the code to the no-account viewer.
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
    'snapshot', coalesce(gs.snapshot, '{}'::jsonb)
  )
  from bpw.games g
  join bpw.teams away on away.id = g.away_team_id
  join bpw.teams home on home.id = g.home_team_id
  left join bpw.game_state gs on gs.game_id = g.id
  where g.id = p_game_id;
$$;

grant execute on function bpw.get_public_game(uuid) to anon, authenticated;
