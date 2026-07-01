-- =====================================================================
-- Family/follower access — Increment 1 of the family-member epic (plan §9).
-- Introduces a 'family' role: an invited follower who can SEE a team's games,
-- live scorebug, schedule and replays in the app WITHOUT being able to score,
-- edit, or manage anything. This is the most-locked-down full-fidelity tier:
-- the team can stay fully private to the outside world while invited family
-- see everything, because access flows through membership, not the public dial.
--
-- NON-DESTRUCTIVE BY DESIGN:
--   * Adds one enum value ('family') — no existing value changed.
--   * Adds a can_view_game() helper and READ-ONLY (SELECT) policies on
--     games/game_events/game_state/lineup_entries. It only WIDENS what can be
--     read; the existing owns_game() write policies are untouched, so scoring /
--     editing / deleting still require owner or scorer+ exactly as before.
--   * No table is dropped or altered; nothing loses access.
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
-- =====================================================================

-- ---------- new role ----------
-- A follower. NOT in can_manage_team / can_score_team, so 'family' members
-- inherit read access below but zero write/management ability.
alter type bpw.team_role add value if not exists 'family';

-- ---------- read predicate: owner OR any active member of either team ----------
-- Distinct from owns_game() (which is scorer+ and gates writes): can_view_game()
-- is the broader "allowed to watch/follow" test that family also passes.
create or replace function bpw.can_view_game(p_game_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (
    select 1 from bpw.games g
    where g.id = p_game_id
      and ( g.owner_id = auth.uid()
            or bpw.is_team_member(g.home_team_id)
            or bpw.is_team_member(g.away_team_id) )
  );
$$;
revoke all on function bpw.can_view_game(uuid) from public;
grant execute on function bpw.can_view_game(uuid) to authenticated;

-- ---------- widen SELECT to viewers (writes stay on owns_game) ----------
-- games: replace the scorer-only select with the broader viewer predicate.
drop policy if exists games_select on bpw.games;
create policy games_select on bpw.games for select using (bpw.can_view_game(id));

-- game_events / game_state / lineup_entries currently have a single
-- `for all using(owns_game)` policy. Add a permissive SELECT-only policy so
-- reads OR in the viewer predicate; writes remain owns_game (that policy stays).
drop policy if exists events_view on bpw.game_events;
create policy events_view on bpw.game_events for select using (bpw.can_view_game(game_id));

drop policy if exists state_view on bpw.game_state;
create policy state_view on bpw.game_state for select using (bpw.can_view_game(game_id));

drop policy if exists lineup_view on bpw.lineup_entries;
create policy lineup_view on bpw.lineup_entries for select using (bpw.can_view_game(game_id));
