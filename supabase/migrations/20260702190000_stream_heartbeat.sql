-- Reliable broadcast-liveness signal for the scorer.
--
-- The scorer previously inferred "is the broadcast live" from P2P heartbeats sent over
-- the Supabase Realtime channel. That channel drops beats on mobile (backgrounding,
-- flaky networks), so the scorer showed false "lost signal" / stuck "connecting" even
-- while Cloudflare was happily streaming. Replace it with a DB heartbeat the broadcaster
-- bumps while its WHIP publish is connected; the scorer/viewer read freshness off the
-- game row (plain reads are reliable even when Realtime hiccups).

alter table bpw.games add column if not exists stream_last_seen_at timestamptz;

create or replace function bpw.stream_heartbeat(p_token text)
returns void
language plpgsql
security definer
set search_path to 'bpw', 'public'
as $$
begin
  update bpw.games set stream_last_seen_at = now()
   where id = bpw.broadcast_game_id(p_token);
end; $$;

grant execute on function bpw.stream_heartbeat(text) to anon, authenticated, service_role;

-- Expose the heartbeat in the public game payload the scorer/viewer already poll.
create or replace function bpw.get_public_game(p_game_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'bpw', 'public'
as $function$
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
    'stream_last_seen_at', g.stream_last_seen_at,
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
$function$;
