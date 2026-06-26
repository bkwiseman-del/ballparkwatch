-- Phone broadcasting is scorer-controlled: only someone holding the game's
-- private share_token (revealed as a link/QR on the scorer's Video screen) can
-- open the broadcaster page. Viewers never receive the token. This resolves a
-- token to the game id + matchup so the broadcaster page can join the right
-- video signaling channel without the filming phone needing an account.

create or replace function bpw.resolve_broadcast(p_token text)
returns jsonb
language sql
security definer
set search_path = bpw, public
stable
as $$
  select jsonb_build_object(
    'game_id', g.id,
    'video_source', g.video_source,
    'away', jsonb_build_object('name', away.name, 'code', away.code),
    'home', jsonb_build_object('name', home.name, 'code', home.code)
  )
  from bpw.games g
  join bpw.teams away on away.id = g.away_team_id
  join bpw.teams home on home.id = g.home_team_id
  where g.share_token = p_token;
$$;

grant execute on function bpw.resolve_broadcast(text) to anon, authenticated;
