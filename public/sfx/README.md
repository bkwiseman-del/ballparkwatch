# Sound FX

Drop these audio files here (filenames must match exactly). MP3 is expected;
keep them small (a few hundred KB each) since they're bundled/served to viewers.

| File         | Used for                                              | Notes |
|--------------|-------------------------------------------------------|-------|
| `crowd.mp3`  | Looping background ambience (plays whenever sound is on) | Make it **seamlessly loopable** (no gap at the loop point). 30–60s is plenty. |
| `pitch.mp3`  | Each pitch (ball / called or swinging strike)         | Short — a mitt pop / whoosh. |
| `hit.mp3`    | Base hits (single / double / triple / home run)       | Bat crack. |
| `catch.mp3`  | Fly outs / line outs / ground outs                    | Glove pop. |
| `foul.mp3`   | Foul balls                                            | Short. |
| `slide.mp3`  | Steals / advances / caught stealing / pick-offs       | Dirt slide. |

The crowd swells briefly on hits and runs scoring. Volumes are tuned in
`src/lib/audio.ts` (crowd rests at ~0.22, FX at ~0.7) — adjust there if needed.

These are git-ignored by default? No — they're committed and served from
`/sfx/<name>.mp3`. If you'd rather not commit large audio, we can move them to
Supabase Storage later.
