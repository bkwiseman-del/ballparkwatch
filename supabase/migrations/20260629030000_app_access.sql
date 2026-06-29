-- Bandbox pre-launch access gate. Auth is shared across the 3 apps, so being
-- signed in is NOT enough to use Bandbox — the email must be on this allowlist.
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).

create table if not exists bpw.app_access (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- Lock it down hard: RLS on with no policies, and revoke the default schema grants
-- so neither anon nor authenticated can read OR write it via the API. Only the
-- service role and the security-definer function below can touch it. (Without this,
-- the schema's default privileges would let any logged-in user insert their own
-- email and self-grant access.)
alter table bpw.app_access enable row level security;
revoke all on bpw.app_access from anon, authenticated;

-- Seed the owner.
insert into bpw.app_access (email, note) values ('brandon@trucksafe.com', 'owner')
  on conflict (email) do nothing;

-- Boolean check for the current user, by their JWT email. Security definer so it can
-- read the locked table; the caller only ever learns true/false about themselves.
create or replace function bpw.has_app_access()
  returns boolean
  language sql
  security definer
  stable
  set search_path = bpw, public
as $$
  select exists (
    select 1 from bpw.app_access
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function bpw.has_app_access() from public;
grant execute on function bpw.has_app_access() to authenticated;
