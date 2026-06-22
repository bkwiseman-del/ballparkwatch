-- "My Teams": let an operator mark the teams they regularly score so they're
-- pre-selected / surfaced first when creating future games.
alter table bpw.teams
  add column if not exists is_favorite boolean not null default false;
