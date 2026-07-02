-- =====================================================================
-- Cloudflare Stream backbone (WHIP ingest / WHEP + HLS playback / auto-recording).
--
-- The phone publishes the upright 16:9 canvas to a Stream Live Input via WHIP;
-- viewers play sub-second via WHEP (HLS fallback); Stream auto-records every
-- broadcast to a VOD we use as the replay. Secrets (CF token + account id) live
-- only in the stream-live Edge Function — this schema just stores the non-secret
-- ids/URLs the pipeline needs.
--
-- WHIP (ingest) URLs contain a secret and are NEVER stored here — the Edge
-- Function fetches them fresh from Cloudflare and hands them only to the
-- token-holding broadcaster. WHEP/HLS are viewer-safe and exposed via
-- get_public_game (subject to the same visibility gate as the rest of the game).
--
-- NON-DESTRUCTIVE: adds columns + RPCs + REPLACE get_public_game (adds fields).
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
-- =====================================================================

-- ---------- per-game Stream state ----------
alter table bpw.games
  add column if not exists cf_live_input_uid text,  -- Cloudflare live input uid
  add column if not exists cf_customer_code   text, -- customer-<code> subdomain for playback URLs
  add column if not exists cf_whep_url        text, -- viewer-safe sub-second WebRTC playback URL
  add column if not exists cf_hls_url         text, -- viewer-safe HLS fallback URL
  add column if not exists cf_recording_uid   text; -- VOD uid of the auto-recording (set after the game)

-- ---------- token-validated RPCs (mirror save_recording's pattern) ----------
-- The broadcaster may be anonymous (opens the broadcaster page via the game's
-- private share_token). These security-definer functions validate the token and
-- read/write only that game's Stream fields, so the Edge Function never needs
-- broad table grants.

-- Look up the game + any existing live input for a broadcast token, so the Edge
-- Function knows whether to reuse or create a Stream live input.
create or replace function bpw.stream_lookup(p_token text)
returns jsonb
language sql
security definer
set search_path = bpw, public
stable
as $$
  select jsonb_build_object(
    'game_id', g.id,
    'cf_live_input_uid', g.cf_live_input_uid,
    'cf_customer_code', g.cf_customer_code
  )
  from bpw.games g
  where g.share_token = p_token;
$$;

-- Store a freshly created live input's ids + viewer-safe playback URLs on the game.
create or replace function bpw.stream_attach(
  p_token text,
  p_uid   text,
  p_code  text,
  p_whep  text,
  p_hls   text
) returns void
language plpgsql
security definer
set search_path = bpw, public
as $$
begin
  update bpw.games
     set cf_live_input_uid = p_uid,
         cf_customer_code   = p_code,
         cf_whep_url         = p_whep,
         cf_hls_url          = p_hls
   where share_token = p_token;
end;
$$;

-- Record the VOD uid of the auto-recording once the broadcast ends (the replay).
create or replace function bpw.stream_set_recording(p_token text, p_recording_uid text)
returns void
language plpgsql
security definer
set search_path = bpw, public
as $$
begin
  update bpw.games set cf_recording_uid = p_recording_uid where share_token = p_token;
end;
$$;

revoke all on function bpw.stream_lookup(text) from public;
revoke all on function bpw.stream_attach(text, text, text, text, text) from public;
revoke all on function bpw.stream_set_recording(text, text) from public;
grant execute on function bpw.stream_lookup(text) to anon, authenticated, service_role;
grant execute on function bpw.stream_attach(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function bpw.stream_set_recording(text, text) to anon, authenticated, service_role;

-- ---------- expose viewer-safe Stream URLs on the public game ----------
-- REPLACE: adds cf_whep_url / cf_hls_url / cf_recording_uid / cf_customer_code to the
-- existing payload (everything else unchanged, same visibility gate).
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
$$;
grant execute on function bpw.get_public_game(uuid) to anon, authenticated;
