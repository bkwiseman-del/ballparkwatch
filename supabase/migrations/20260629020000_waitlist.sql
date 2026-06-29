-- Bandbox pre-launch waitlist — email capture from the public marketing page.
-- Apply via the Supabase SQL editor (the bpw schema is shared; see CLAUDE.md).

create table if not exists bpw.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  source     text,
  created_at timestamptz not null default now()
);

alter table bpw.waitlist enable row level security;

-- Anyone (an anonymous marketing visitor) may add themselves to the list. There is
-- deliberately NO select/update/delete policy, so the list is never readable through
-- the public API — only via the service role / SQL editor.
drop policy if exists "anon can join waitlist" on bpw.waitlist;
create policy "anon can join waitlist"
  on bpw.waitlist
  for insert
  to anon, authenticated
  with check (true);

-- The schema's default privileges give anon only SELECT (and RLS has no select policy,
-- so the list stays unreadable). Anon needs an explicit INSERT grant to add a row.
grant insert on bpw.waitlist to anon;
