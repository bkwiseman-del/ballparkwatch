-- =====================================================================
-- Sponsor banners (plan §sponsor boards — the family-free, sponsor-funded lever).
-- A team uploads a clickable sponsor logo; it renders as a flat panel on the watch
-- page, a booster fundraiser. Public bucket for the images; team_sponsors rows;
-- active sponsors exposed to anon viewers via get_public_game.
--
-- NON-DESTRUCTIVE: new bucket + table + REPLACE get_public_game (adds a field).
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
-- =====================================================================

-- ---------- public bucket for sponsor logos ----------
insert into storage.buckets (id, name, public) values ('bpw-sponsors', 'bpw-sponsors', true)
  on conflict (id) do nothing;

-- Public read; only a team's managers can write into that team's folder (<team_id>/…).
drop policy if exists sponsors_read on storage.objects;
create policy sponsors_read on storage.objects for select using (bucket_id = 'bpw-sponsors');

drop policy if exists sponsors_write on storage.objects;
create policy sponsors_write on storage.objects for all to authenticated
  using (
    bucket_id = 'bpw-sponsors'
    and exists (
      select 1 from bpw.team_members m
      where m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin')
        and m.team_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'bpw-sponsors'
    and exists (
      select 1 from bpw.team_members m
      where m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin')
        and m.team_id::text = (storage.foldername(name))[1]
    )
  );

-- ---------- sponsors ----------
create table if not exists bpw.team_sponsors (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references bpw.teams (id) on delete cascade,
  name         text,
  image_path   text not null,          -- path within the bpw-sponsors bucket
  click_url    text,
  active       boolean not null default true,
  -- Moderation: uploads start 'pending' and are ONLY shown publicly once 'approved'
  -- (fail-closed). An AI check on upload auto-approves clean ones; anything it flags
  -- stays pending for manual review. review_note carries the reason when flagged.
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note  text,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists team_sponsors_team_idx on bpw.team_sponsors (team_id);

alter table bpw.team_sponsors enable row level security;
drop policy if exists team_sponsors_read on bpw.team_sponsors;
create policy team_sponsors_read on bpw.team_sponsors for select using (bpw.is_team_member(team_id));
drop policy if exists team_sponsors_write on bpw.team_sponsors;
create policy team_sponsors_write on bpw.team_sponsors for all
  using (bpw.can_manage_team(team_id)) with check (bpw.can_manage_team(team_id));

-- ---------- expose active sponsors on the public game ----------
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
