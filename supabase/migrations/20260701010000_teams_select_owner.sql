-- Inserting a team with .select() (INSERT ... RETURNING) failed RLS: the SELECT policy
-- (is_team_member) can't see the owner-membership row the AFTER trigger adds in the same
-- statement. Let an owner always select their own team, independent of the trigger.
drop policy if exists teams_select on bpw.teams;
create policy teams_select on bpw.teams
  for select using (owner_id = auth.uid() or bpw.is_team_member(id));
