-- Public bucket for cached AI voice-commentary clips (one mp3 per game/seq).
-- Public so viewers can fetch by URL; the recap/commentary function uploads with
-- the service role.
insert into storage.buckets (id, name, public)
values ('bpw-audio', 'bpw-audio', true)
on conflict (id) do nothing;
