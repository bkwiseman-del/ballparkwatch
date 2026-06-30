-- Let users create their own seasons (Fall Ball, cross-year travel, league calendars).
-- Canonical seasons (owner_id null) stay visible to everyone; a custom season is
-- visible only to its owner; owners can insert their own.
drop policy if exists seasons_read on bpw.seasons;
create policy seasons_read on bpw.seasons
  for select using (owner_id is null or owner_id = auth.uid());
drop policy if exists seasons_insert on bpw.seasons;
create policy seasons_insert on bpw.seasons
  for insert with check (owner_id = auth.uid());
