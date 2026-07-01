-- =====================================================================
-- Two-axis visibility (plan §8). The old single dial (private/discoverable/public)
-- conflated two independent things. Split them:
--   ① broadcast_audience — who can WATCH the video: members | link | public
--        members = signed-in members only (share link blocked)
--        link    = anyone with the share link (DEFAULT; no account) — video NOT on the public page
--        public  = link + replays embedded on the public team page
--   ② discovery — the stats/score/schedule PAGE: discoverable | private
--
-- NON-DESTRUCTIVE: adds a column with a safe default and MIGRATES existing rows so
-- behavior is preserved (old 'public' teams keep video-on-page; everyone else keeps
-- link video). Then collapses discovery 'public' → 'discoverable' (video moved to the
-- new axis). Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
-- =====================================================================

alter table bpw.teams
  add column if not exists broadcast_audience text not null default 'link'
    check (broadcast_audience in ('members', 'link', 'public'));

-- Preserve current behavior: teams that were 'public' showed video on the page.
update bpw.teams set broadcast_audience = 'public' where discovery = 'public';
-- discovery is now just discoverable/private; the video axis owns 'public'.
update bpw.teams set discovery = 'discoverable' where discovery = 'public';

-- ---------- public team page: replays gated on broadcast_audience, not discovery ----------
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
      select jsonb_agg(jsonb_build_object('name', bpw.names_down(p.name), 'number', p.jersey_number)
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
grant execute on function bpw.get_public_team(text) to anon, authenticated;

-- ---------- share-link watch: members-only teams block non-members ----------
-- If a members-only team is on either side of the game and the caller isn't one of its
-- members, the watch page returns nothing (the share link won't stream). Anon → blocked.
-- link/public teams are unaffected (share link always works).
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
  where g.id = p_game_id
    and not exists (
      select 1 from bpw.teams tt
      where tt.id in (g.home_team_id, g.away_team_id)
        and tt.broadcast_audience = 'members'
        and not bpw.is_team_member(tt.id)
    );
$$;
grant execute on function bpw.get_public_game(uuid) to anon, authenticated;
