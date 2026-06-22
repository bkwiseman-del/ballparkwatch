-- No-account viewer feed: ordered events with batter names, for play-by-play and
-- box score on the viewer. SECURITY DEFINER so anon can read one game's log.
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
        'payload', e.payload
      ) order by e.seq
    ),
    '[]'::jsonb
  )
  from bpw.game_events e
  left join bpw.players p on p.id = e.batter_id
  where e.game_id = p_game_id;
$$;

grant execute on function bpw.get_public_events(uuid) to anon, authenticated;
