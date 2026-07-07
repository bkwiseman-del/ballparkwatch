-- Multi-angle games: a phone angle + an external camera on the same stage, composited to one HLS
-- view (grid). Reuses the camera composite pipeline; phone-only games are untouched (stay sub-second).
alter type bpw.video_source add value if not exists 'multi';
