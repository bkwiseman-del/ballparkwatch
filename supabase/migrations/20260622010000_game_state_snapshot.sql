-- Phase 1: a denormalized snapshot of the live projection so viewers read ONE
-- row for instant scorebug updates (the build plan's cached-snapshot idea),
-- plus enable Realtime on game_state.

alter table bpw.game_state
  add column if not exists snapshot jsonb not null default '{}'::jsonb;

-- Realtime: publish game_state changes to subscribed viewers. Adding only our
-- table to the shared publication; other apps' tables are untouched.
do $$ begin
  alter publication supabase_realtime add table bpw.game_state;
exception when duplicate_object then null; end $$;
