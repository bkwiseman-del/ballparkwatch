-- Public team page data (plan §8 "team page"). Anon-readable, visibility-gated by
-- the team's discovery setting. Apply via the Supabase SQL editor (see CLAUDE.md).

-- Names-down: "Carson Smith" -> "Carson S." (first token + last token's initial).
create or replace function bpw.names_down(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then p
    when array_length(string_to_array(btrim(p), ' '), 1) = 1 then btrim(p)
    else split_part(btrim(p), ' ', 1) || ' '
         || left(split_part(btrim(p), ' ', array_length(string_to_array(btrim(p), ' '), 1)), 1) || '.'
  end;
$$;

-- One call for a public team page: meta + record + results + roster (names-down).
-- Returns null for private/unknown teams. Replays are surfaced only when the team is
-- fully 'public' (discoverable = stats + names-down, no video — §8).
create or replace function bpw.get_public_team(p_slug text)
returns jsonb
language sql
security definer
set search_path = bpw, public
stable
as $$
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
               'replay', (t.discovery = 'public' and g.recording_path is not null)
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
grant execute on function bpw.names_down(text) to anon, authenticated;
