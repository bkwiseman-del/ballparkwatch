-- =====================================================================
-- Messaging (one-way announcements) — Increment 5 of the family epic.
-- Staff post; every member (incl. family) reads. "Game moved to Field 3",
-- "Bring white jerseys", etc. Threads/replies can come later.
--
-- NON-DESTRUCTIVE: new table + list RPC. Apply via the Supabase SQL editor.
-- =====================================================================

create table if not exists bpw.team_posts (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references bpw.teams (id) on delete cascade,
  author_id  uuid not null default auth.uid() references auth.users (id),
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists team_posts_team_idx on bpw.team_posts (team_id, created_at desc);

alter table bpw.team_posts enable row level security;
revoke all on bpw.team_posts from anon;

drop policy if exists team_posts_read on bpw.team_posts;
create policy team_posts_read on bpw.team_posts for select using (bpw.is_team_member(team_id));
-- Only staff (non-family members) can post/edit/delete.
drop policy if exists team_posts_write on bpw.team_posts;
create policy team_posts_write on bpw.team_posts for all
  using (bpw.is_team_staff(team_id)) with check (bpw.is_team_staff(team_id));

-- Recent announcements with a friendly author name.
create or replace function bpw.team_posts_list(p_team_id uuid, p_limit int default 20)
returns table (id uuid, body text, author text, created_at timestamptz)
language sql security definer stable set search_path = bpw, public as $$
  select p.id, p.body,
         coalesce(
           nullif(u.raw_user_meta_data->>'full_name', ''),
           nullif(u.raw_user_meta_data->>'name', ''),
           split_part(u.email, '@', 1)
         ) as author,
         p.created_at
  from bpw.team_posts p
  join auth.users u on u.id = p.author_id
  where p.team_id = p_team_id and bpw.is_team_member(p_team_id)
  order by p.created_at desc
  limit greatest(p_limit, 1);
$$;
revoke all on function bpw.team_posts_list(uuid, int) from public, anon;
grant execute on function bpw.team_posts_list(uuid, int) to authenticated;
