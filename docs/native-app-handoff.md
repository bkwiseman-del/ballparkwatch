# Bandbox → Native App — Handoff Brief

**Purpose:** hand this to a fresh Claude Code session to **plan** (not yet build) a native mobile app
for Bandbox. The web PWA is validated in real games; we're moving to native for a better camera /
broadcast / playback experience and app-store distribution. This brief captures everything pertinent:
what Bandbox is, what's built and validated, the hard-won gotchas, the architecture and data model,
what to reuse vs rebuild, and the key decisions + a recommended path. Written 2026-07-20.

> Read the existing docs alongside this: [bandbox-plan.md](bandbox-plan.md) (unified product plan),
> [ivs-migration-plan.md](ivs-migration-plan.md) (video architecture), [clip-sharing](bandbox-clip-sharing.md),
> and the repo [README.md](../README.md) (current status + known limitations). The auto-memory under
> `~/.claude/projects/-Users-bwiseman-projects-ballpark-watch/memory/` has dense, current context
> (pricing, video, teams, deploy, camera gotchas) — mine it.

---

## 1. What Bandbox is

Live baseball **scoring + streaming** PWA for youth/amateur leagues — a GameChanger competitor. One
parent **scores** play-by-play; family **watches** a live video stream with a synced scorebug via a
no-account share link. Video is optional (works stats-only). Brand: "vintage athletic, rendered flat"
(cream / ink-navy / barn-red / board-green / gold; hard corners, no shadows). Domains: **bandbox.tv**
(primary), bandboxlive.com.

**Core differentiator vs GameChanger:** **the family never pays to watch live** (GC paywalls
viewing). Revenue = paid replay/clips/keepsakes + sponsors + team/facility subs. See §7.

---

## 2. Architecture (the non-negotiable core)

**Event-sourced.** `bpw.game_events` is the immutable source of truth. The live score/count/box score
are **projections** of the log. `bpw.game_state` is a cached one-row-per-game snapshot viewers
subscribe to via Realtime. Video is an orthogonal, optional layer — it never touches the data model.
Every AI feature is a producer (writes events) or consumer (reads the log).

This is the crown jewel and must carry to native **unchanged in spirit**: the scoring engine, stats,
commentary, and recap are all pure functions over the event log.

### Stack (web, today)
React + Vite + TypeScript PWA · Tailwind · React Router · Supabase (Postgres + Auth + Realtime +
Storage + Edge Functions) · **Amazon IVS** (video) · ElevenLabs (TTS commentary) · Anthropic/Claude
(lineup OCR, recap). All third-party secrets live **only** in Edge Functions, never client-side.

### Backend (100% reusable by native — do NOT rebuild)
- **Supabase project** `dlroexthlluabuiqdiip`, shared with two other apps, isolated in a dedicated
  **`bpw` Postgres schema** (never `public`; storage paths prefixed `bpw/`). Client created with
  `{ db: { schema: 'bpw' } }`. `bpw` must be in the PostgREST exposed-schemas list.
- **Auth is project-wide** (shared across 3 apps) → RLS is **ownership-based** (`owner_id = auth.uid()`),
  never "any authenticated user". Children inherit ownership via `bpw.owns_game()`.
- **Migrations** applied via the Supabase SQL editor / Management API (NOT `supabase db push` — the
  migration-history table is shared). Service role has **RPC-only** access to `bpw`.
- **Edge Functions** (Deno): `stream-ivs` (video broker — stage/token/composition/recording/cap/health),
  `commentary` (ElevenLabs TTS, content-hash cached), `recap` (Claude), `scan-lineup` (Claude OCR),
  `ice-servers`. All reusable from native via HTTPS.

---

## 3. What's built & validated (real youth games, 2026)

- **Scoring cockpit** — full play-by-play (pitches, baserunners, subs, in-play resolver incl.
  **infield-fly** auto-gated, undo/edit any past play), live scorebug + box score projected from the
  log, write-ahead log for crash safety, realtime push to viewers, share links.
- **Scoreboard mode** — a *pure* scoreboard (runs/hits/outs/count only; NO baserunners/lineup/order).
- **Scorer reliability** — a **monotonic self-healing resync** (focus/visibility/interval/post-mount)
  that reconciles to the immutable log, adopts server state when behind, re-persists when ahead, and
  never regresses. Fixed the "reload dropped a run / jumped back an inning" bug.
- **Public viewer** — no-account watch page: scorebug, box/plays/stats, field diagram, AI commentary,
  replay with a branded player, **live viewer count** (Realtime presence).
- **Video (Amazon IVS)** — see §4. Phone broadcast is reliable; external camera works but is
  bandwidth-bound (see §5). Multi-angle (phone + camera) switcher + per-angle switchable replay.
- **AI** — ElevenLabs commentary (sound FX + play-by-play + per-batter "day line"), Claude recap,
  Claude lineup-photo OCR.
- **Privacy/names** — server-enforced public name floor (§6).

---

## 3a. FULL PRODUCT SCOPE & ROADMAP — the native app must encompass ALL of this

§3 is only what's *built*. Bandbox is a much bigger product; the native plan must account for these
planned layers (each has an authoritative doc — read them). **Governing principle throughout:
everything degrades gracefully without a league and gets better with one; streaming is the payload,
management is the door.**

- **League & Field Management** — [bandbox-league-field-build-plan.md](bandbox-league-field-build-plan.md)
  (v2, deep) + [deep-dive](bandbox-league-field-management-deep-dive.md). An **Organization above
  teams**: seasons, divisions, standings/leaderboards (rolled up from the event-sourcing spine),
  **Stripe-Connect registration** + season rollover, **multi-guardian** notifications, a
  **field-aware scheduling engine** (games/practices/rentals/maintenance on ONE field calendar, no
  double-booking, right diamond for the age group), **tournaments** (pool→bracket of ghost opponents
  resolving as games finish), a **live pre-season draft** room (reuses live-scoring realtime), and a
  **public league site that writes itself** (schedule/standings/teams/field map/registration/live
  games). This is the top-down pre-loader that fills the whole model. Later phase; big surface,
  different buyer. Timing: **Sports Connect sunset in 2027** forces 15k+ orgs to re-shop.
- **Game & Broadcast Workflow** — [bandbox-game-broadcast-workflow-build-plan.md](bandbox-game-broadcast-workflow-build-plan.md)
  (canonical). A **game is a "room"**; **ghost opponents / ghost-first playability** (a backyard game
  works with no league — pairing code, manual entry); **Field QR = the front door** (scan to
  watch/claim); **camera angles are a shared pool** attached to the matchup with per-audience defaults
  (this is the "add-as-you-go multi-angle / `broadcasts` model" — field/opponent owners
  forward-compatible); **free vs paid is per-seat/per-audience**; a **privacy model across every
  scenario**; and the league layer pre-fills matchups/fields/rosters/consent.
- **Simulcast to third-party platforms (FB/YouTube/etc.)** — [competition-ip-simulcast brief](bandbox-build-brief-competition-ip-simulcast.md).
  Three output tiers (owned viewer = full/interactive; public simulcast = **burned-in** scorebug +
  CTA/QR, single angle; stats-only). **COPYRIGHT-CRITICAL:** on public simulcasts the **camera mic is
  OFF**; audio = **AI commentary + owned/royalty-free crowd SFX**, because FB/YT **Content ID
  auto-flags copyrighted PA/walk-up music** (present at nearly every game) and can mute/block/strike
  the stream. Competitors tell users to "add an announcer"; **Bandbox ships the announcer** — a real
  wedge. Funnel = auto-deep-link + burned-in QR back to Bandbox.
- **Walk-up songs** (engagement feature, user-requested) — play a batter's chosen walk-up song when
  they come to bat. **Copyright nuance is the whole design:** fine on the **owned/family viewer**
  (private) with a **licensed/royalty-free library or user-provided audio**; must be **OFF or
  synthetic on public simulcasts** (Content ID). Native is actually a better home for this
  (background audio, a bundled/streamed music library). **Decision needed:** licensed library vs
  user-upload vs both. Ties into the AI-commentary audio bus.
- **Clips / keepsakes** — [bandbox-clip-sharing.md](bandbox-clip-sharing.md). Offline-rendered branded
  play clips (alpha stinger + auto-data lower-third from the event log + end card), **Parent/Family
  premium**. Auto-surfaced highlights + season reels. Native camera roll / share-sheet integration is
  a plus.
- **Family / followers** — the family/follower user type (email invites, follow-a-team, member = the
  private full view). See the `bandbox-family-epic` memory. **Push notifications** ("your kid's game
  is live / a highlight is ready") are a native-unlock retention lever GC leans on.
- **Privacy & consent model** — server-enforced (see §6). Registration is where **guardian media
  releases** are collected (the legal spine) and where the `displayName()` floor defaults are set.
- **Growth loops & reliability moat** — [growth-and-reliability notes](bandbox-growth-and-reliability-build-notes.md).
  Positioning: **"never dies, not never drops"** — reconnect-not-fatal, stats/video orthogonality,
  **upload-side adaptive bitrate** (this is exactly the camera-bandwidth issue in §5 — native/phone
  paths adapt), multi-angle failover.

### ⚠️ Critical build constraints the native app MUST honor
- **IP / patent design-around** ([competitive-and-IP memo](bandbox-competitive-and-ip-memo.md)): do
  **NOT** implement "tap a rendered field diagram to mark hit location" as a scoring input (GameChanger
  patents active to ~2029-2030). Capture location via a **fielder + trajectory** model (tap the
  fielder + hit-type + depth + direction). **Spray-chart OUTPUT is fine.** The web app already follows
  this — keep it in native. Not legal advice.
- **Copyright-safe audio on any public/simulcast surface** (above): synthetic/owned audio only.
- **Reliability**: assume the connection *will* drop; buffer + auto-resume; never let a video failure
  kill the scoreboard.

### Superseded / stale docs — DO NOT plan from these
`docs/product-strategy.md` (superseded by [bandbox-plan.md](bandbox-plan.md)) and
`docs/bandbox-server-recorder-spec.md` (the Railway/GStreamer recorder — **deleted**, replaced by IVS).
Treat any Cloudflare-Stream references in older docs as historical (we're on **Amazon IVS** now).

---

## 4. Video architecture (Amazon IVS) — READ CAREFULLY

One **IVS Real-Time stage per game**. Two ingest paths onto the stage:
- **Phone** → WebRTC/**WHIP** (sub-second, adaptive bitrate). Reliable.
- **External camera** → **RTMP(S)** via an IVS ingest-configuration stream key (OBS / DJI / GoPro).

Delivery to viewers:
- **Phone / multi-angle** → viewers **subscribe to the stage over WebRTC** (sub-second). Scorebug via
  Supabase Realtime (naturally synced). Per-angle switcher for multi.
- **Single external camera (`camera_rtmp`)** → the stage is **composited** server-side to a
  low-latency **HLS channel** (~2–5s); scorebug via **IVS timed metadata** (`put-metadata` →
  `TEXT_METADATA_CUE`), frame-synced.

Recording/replay:
- **Composite recording** → S3 (started at first pitch, stopped at game end → no pre-game footage),
  served via **CloudFront** (private bucket `bandbox-recording`, OAC). Encoder config **720p @ 5 Mbps**
  (ARN `Ebf4Lx9AuW9Z`; `IVS_ENCODER_ARN` secret).
- **Multi-angle** → **individual participant recording** (one VOD per angle) → switchable-angle replay;
  falls back to the composite VOD if per-angle isn't available.

`stream-ivs` Edge Function actions: `start` (stage + tokens + RTMP ingest + channel), `game-start`
(StartComposition), `game-end`/`stop-input` (StopComposition + disconnect), `put-metadata`,
`finalize` (resolve replay VOD(s)), `viewer-token` (SUBSCRIBE token + **5-viewer free cap** + `health`/
`preview` roles), `stream-status` (publishing check).

**Cost:** WebRTC viewers bill per participant-hour (~$0.072). HLS/replay is cheap CDN egress. Hence
the free-tier **5-concurrent-WebRTC-viewer cap** (enforced server-side in `viewer-token`).

---

## 5. HARD-WON GOTCHAS — do not relearn these the hard way

1. **External camera (RTMP): preview ≠ stream.** The scorer's setup **preview** is a direct WebRTC
   subscribe (works). The live stream + recording for `camera_rtmp` come from the server-side
   **composition** (different path). **A good preview does NOT prove the stream works.**
2. **Black video + good audio + stable connection = BANDWIDTH, not a bug.** RTMP is **fixed-bitrate**
   and can't adapt. On a thin uplink — classically the **scoring phone used as a cellular hotspot** at
   a crowded park — the video starves (keyframes are large, don't arrive) → **black**, while the tiny
   audio keeps flowing and TCP stays "connected." WiFi works; cellular hotspot goes black. **This is a
   universal RTMP/uplink constraint — GameChanger hits it too.** Confirmed via ffmpeg (recording pure
   black, YAVG=16, vs a phone recording at YAVG≈135). **Native advantage:** native IVS broadcast SDKs
   (and the phone WHIP path) are adaptive; leaning on phone-as-camera or a native adaptive path avoids
   this. External hardware cameras will always depend on their uplink.
3. **"Camera live" was a false green** — the old signal only checked the participant was *publishing*
   (audio keeps it published). Now there's a real **video-health check** (`useCameraVideoHealth`):
   subscribe as a `health` probe and watch the camera's video MediaStreamTrack (`muted`/`readyState`)
   → warn "camera connected, but no video is reaching the stream." Carry this concept to native.
4. **Web IVS quirks** (may vanish on native SDKs): `amazon-ivs-player` needs the `events` npm polyfill
   or it crashes in a Web Worker (uncatchable by error boundaries); muted-autoplay required; channel
   HLS 404s for ~10-15s after StartComposition (needs retry); alpha video for stingers isn't
   cross-browser (Safari) — see clip-sharing doc.
5. **Recording S3 bucket policy is fragile** — composite AND individual recording use the same
   storage-config write grant (`ivs-composite.<region>.amazonaws.com`). Editing/probing a storage
   config can silently drop the policy statement → back up + restore the FULL bucket policy if you
   touch it. CloudFront OAC read + IVS write must both be present.
6. **Deploy:** web auto-deploys to Vercel on push to `main` (GitHub integration). Don't say "live" off
   a push — verify the build went READY (builds can flake). Edge Functions + migrations deploy
   separately. (Native will have its own store pipeline — see §9.)

---

## 6. Privacy / name-safety (server-enforced — replicate exactly)

Public game RPCs floor names **on the server** via `bpw.public_player_name(name, jersey, is_ghost,
full_ok)`:
- **Ghost/opponent** → jersey number (`#24`), or a kept generic label ("Player 1"), else suppressed.
- **Team opted in** (`teams.show_full_names = true`) → full names to its viewers.
- **Default floor** → **first name + last initial** ("Carson S.").

Client renders the server string **verbatim** (no client re-flooring — that would clobber an opted-in
full name). AI commentary audio is a public surface → also floored. **Open request (not built):** a
per-team convention of **first-initial + last name** ("C. Siefferman") for a team's own players — a
new format for the chokepoint. This is an *actively-changing area* (another session owns it) — the
native effort must consume whatever the RPCs return and NOT re-derive names client-side.

---

## 7. Monetization (decided) — shapes native paywalls/IAP

**Family never pays to WATCH LIVE.** Free tier = **live viewing only** (5-viewer cap), scoring,
stats, share links. **No free replay.** Paid = **replay + recording + clips + AI archive**. Two goods,
two payers: **team/single-game** buys the shared **broadcast good** (recording exists once);
**parent/family premium** buys the private **personal good** (branded clips/keepsakes of their kid).
Clips = a Parent/Family premium feature (see [clip-sharing](bandbox-clip-sharing.md) — alpha stinger +
auto-data lower-third + end card, offline render). **Native caveat:** Apple/Google take 15–30% on IAP;
web billing (Stripe) dodges it — plan the purchase surfaces accordingly (e.g., account/upgrade on web,
entitlements synced to the app). Full model in the `ballpark-watch-pricing` memory.

---

## 8. What to REUSE vs REBUILD for native

| Piece | Reuse? | Notes |
|---|---|---|
| **Supabase backend** (Postgres/`bpw`, Auth, Realtime, Storage, Edge Functions) | ✅ reuse 100% | Works from any client over HTTPS/websocket. `supabase-js` runs in React Native; native Swift/Kotlin clients exist too. |
| **Event-sourcing engine, stats, commentary-cue builder, recap** (`src/lib/engine.ts`, `stats.ts`, `commentary.ts`, `names.ts`) | ✅ if RN/Expo (pure TS) | These are pure TS over the event log — portable to React Native directly. In a Swift/Kotlin app they'd need re-implementation (or a JS runtime). **This is the single biggest argument for React Native.** |
| **IVS video** | ✅ concept; native SDKs are BETTER | IVS has first-class **iOS/Android native broadcast + player SDKs** — native camera publish (WHIP), native low-latency player, background audio, **PiP + AirPlay/Chromecast that actually work**, more robust than web WHIP/WHEP. RN wrappers exist but maturity must be validated (see §10). |
| **Design system** (tailwind tokens, flat aesthetic, fonts) | ✅ tokens; reimplement components | NativeWind brings Tailwind to RN (reuse the token values). Fonts: Alfa Slab One, Saira Condensed, Archivo. |
| **PWA-specific plumbing** (service worker, Vercel, DOM video controls, WebRTC-in-browser) | ❌ rebuild native | Native handles video/audio/PiP/casting/notifications natively — much of the web complexity disappears. |

---

## 9. Key decisions the planning session must make (with a recommendation)

1. **Framework — the pivotal choice.**
   - **Recommended: React Native + Expo.** Rationale: reuses the validated **TypeScript event
     engine + stats + commentary + Supabase client** verbatim (huge — it's the crown jewel), NativeWind
     reuses the design tokens, and Expo gives a fast path to iOS+Android with OTA updates. The one risk
     to retire first is IVS native-module maturity in RN (broadcast especially).
   - Alternatives: Flutter (reimplement engine in Dart — loses reuse) or fully-native Swift+Kotlin
     (best video SDK ergonomics, but 2× the app and reimplement the engine). Only pick these if RN's
     IVS story proves inadequate.
2. **VALIDATE FIRST (matches the team's "prove it before committing" ethos):** before choosing RN,
   spike the **IVS Real-Time broadcast + player in React Native** on a real device — phone WHIP
   publish, stage subscribe, low-latency player, PiP, and background audio. If the RN IVS modules are
   too immature, reconsider (native modules you write, or a native shell). Don't commit the framework
   until this spike passes.
3. **Reuse strategy for the engine:** extract `engine.ts`/`stats.ts`/`commentary.ts`/`names.ts` into a
   shared TS package (already dependency-light, pure functions) so web + native share one source of
   truth. This also de-risks divergence.
4. **Offline scoring:** native can do real offline (the WAL concept → a local DB / MMKV / SQLite) so a
   scorer never loses plays with no signal. Bigger win than the web WAL. Design the sync to reuse the
   monotonic-resync idea (never regress; converge to the log).
5. **Push notifications:** native unlocks "your kid's game is live / a highlight is ready" — a real
   retention lever GC leans on. Plan APNs/FCM via Expo.
6. **Casting/PiP:** native AirPlay/Chromecast + PiP are first-class — the thing web couldn't do. This
   is a concrete reason native is *better*, not just distributable.
7. **Billing/IAP:** decide web-Stripe-entitlements vs native IAP given the 15–30% cut (§7).
8. **Migration/coexistence:** the web PWA stays live during native dev (same backend). No data
   migration needed — same Supabase project. Plan a period where both clients hit the same `bpw` schema.

---

## 10. Suggested first steps for the planning session

1. Read: this brief (esp. **§3a full scope**), [README.md](../README.md),
   [bandbox-plan.md](bandbox-plan.md), [ivs-migration-plan.md](ivs-migration-plan.md), and the full-scope
   docs — [game-broadcast-workflow](bandbox-game-broadcast-workflow-build-plan.md),
   [league-field build plan](bandbox-league-field-build-plan.md) + [deep-dive](bandbox-league-field-management-deep-dive.md),
   [competition-ip-simulcast](bandbox-build-brief-competition-ip-simulcast.md),
   [competitive-and-IP memo](bandbox-competitive-and-ip-memo.md),
   [growth-and-reliability](bandbox-growth-and-reliability-build-notes.md),
   [clip-sharing](bandbox-clip-sharing.md) — plus the auto-memory files. (Ignore the superseded docs
   named in §3a.)
2. **Spike the risk:** IVS Real-Time in React Native on a physical device (publish + subscribe +
   player + PiP). Decide RN vs alternatives from the result.
3. Extract the engine/stats/commentary into a shared TS package; prove it runs unchanged in an RN
   context.
4. Draft the native app's screen map from the web routes (`/setup`, `/score/:id`, `/watch/:id`,
   team/following, replay/final) **plus the planned surfaces** (league/org admin, schedule + field
   calendar, standings, registration, public league site, tournament brackets, draft room, family/
   follow feed, clips/keepsakes, walk-up-song setup) — and rethink video + notifications for native.
5. Produce a phased native build plan that covers **all layers, not just scoring/video**: mirror the
   web core (scaffolding → scoring+scorebug → video → AI → clips), then layer in family/followers +
   notifications, simulcast (copyright-safe audio), walk-up songs, and — as a later, larger phase —
   league/field management + registration. Include acceptance tests and a coexistence plan with the
   live PWA (same Supabase backend, no data migration).

---

## 11. Access / where things live

- **Repo:** `github.com/bkwiseman-del/ballparkwatch` (branch `main`; web auto-deploys to Vercel →
  bandbox.tv). Native app can be a new repo or a monorepo package sharing the engine.
- **Supabase:** project `dlroexthlluabuiqdiip`, schema `bpw`. Edge Functions deploy via
  `supabase functions deploy <name> --project-ref dlroexthlluabuiqdiip`.
- **AWS (IVS):** dedicated account/profile `bandbox` (us-east-1). Recordings bucket `bandbox-recording`
  behind CloudFront `d1gsn7t2u3d2yz` (OAC). Encoder config `Ebf4Lx9AuW9Z` (720p@5Mbps). Storage config
  `vO9d0bdSaHfb`. **TODO (still open):** scope the `bandbox-edge` IAM user down from AdministratorAccess
  to `BandboxEdgePolicy` (IVS + recordings bucket only).
- **Secrets:** all third-party keys (AWS, ElevenLabs, Anthropic) live ONLY in Supabase Edge Function
  secrets — native must call the Edge Functions, never hold these keys.
- **Docs/memory:** `docs/` in the repo + the auto-memory directory (pricing, video, teams, deploy,
  camera gotchas, multi-angle).

---

## 12. Open items inherited from the web (carry into native planning)

- **#2 name convention:** "first-initial + last name" for a team's own players — not yet in the server
  chokepoint (other session's area).
- **IAM scope-down** of `bandbox-edge` (housekeeping).
- **Add-as-you-go multi-angle** provisioning (a `broadcasts` model) — see the multi-angle memory.
- **Clip sharing** feature (spec'd, not built) — the Parent-premium keepsake generator.
- External hardware cameras will always be uplink-bound; native should prefer the **adaptive** phone
  path as the default and treat external cameras as an advanced option with the video-health warning.
