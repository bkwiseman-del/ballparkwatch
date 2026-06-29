-- Game video recording: the broadcaster's MediaRecorder capture is uploaded to a
-- public bpw-video bucket and replayed on the viewer's Final screen, synced to the
-- event log. Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).

-- Public bucket — viewers fetch the recording by URL; the broadcaster uploads to it.
insert into storage.buckets (id, name, public)
values ('bpw-video', 'bpw-video', true)
on conflict (id) do nothing;

-- The filming phone may be anonymous (it opens the broadcaster page via the game's
-- private share_token link), so allow it to insert objects into this bucket.
drop policy if exists "broadcast can upload video" on storage.objects;
create policy "broadcast can upload video"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'bpw-video');

-- One current recording per game (v1). started_at is the wall clock when recording
-- began — the anchor that aligns event wall_clock_ts to a time offset in the video.
alter table bpw.games
  add column if not exists recording_path        text,
  add column if not exists recording_started_at  timestamptz,
  add column if not exists recording_mime         text,
  add column if not exists recording_duration_ms  int;

-- The broadcaster (possibly anon) saves its recording by the game's private token;
-- this security-definer RPC validates the token and writes the metadata to that game.
create or replace function bpw.save_recording(
  p_token       text,
  p_path        text,
  p_started_at  timestamptz,
  p_duration_ms int,
  p_mime        text
) returns void
language plpgsql
security definer
set search_path = bpw, public
as $$
begin
  update bpw.games
     set recording_path        = p_path,
         recording_started_at   = p_started_at,
         recording_duration_ms  = p_duration_ms,
         recording_mime         = p_mime
   where share_token = p_token;
end;
$$;

revoke all on function bpw.save_recording(text, text, timestamptz, int, text) from public;
grant execute on function bpw.save_recording(text, text, timestamptz, int, text) to anon, authenticated;
