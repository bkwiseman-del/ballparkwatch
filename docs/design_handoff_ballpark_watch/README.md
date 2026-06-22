# Handoff: Ballpark Watch

## Overview
Ballpark Watch is a live baseball scoring and streaming app for youth and amateur leagues. It has two primary user roles: the **Scorer** (parent/coach running the game from the dugout) and the **Viewer** (anyone watching live via a share link). A **Setup** flow handles pre-game lineup management including a photo-scan-to-roster feature.

## About the Design Files
The `.html` files in this package are **high-fidelity design references created as HTML prototypes** — not production code to ship directly. Your task is to recreate these designs in your target codebase (React Native recommended for mobile, React for web) using its established patterns and libraries. Treat the HTML as a pixel-accurate visual spec.

The `LiveTabs Reference.html` file contains the interactive viewer field tab component (Field / Plays / Box / Stats) with working tab switching — useful for understanding the tab behavior.

The `product-brief.md` contains the full product brief including technical architecture notes.

## Fidelity
**High-fidelity.** Colors, typography, spacing, iconography, and interaction patterns are all final. Recreate pixel-accurately.

---

## Design Tokens

### Colors
| Token | Hex | Usage |
|---|---|---|
| Cream | `#F4ECD8` | Base background, light surfaces |
| Ink Navy | `#1A2A4A` | Primary text, dark surfaces, borders |
| Barn Red | `#A6342E` | Strikes, outs, LIVE badge, destructive actions |
| Board Green | `#2C5234` | Field background, BALL button, panels |
| Field Green (dark) | `#1E3A24` | Scoreboard panel, dark headers |
| Night Green | `#15281b` | Darkest surface, video backgrounds |
| Gold | `#C9A14A` | Home team accent, runners on base, CTA |
| Cream off-white | `#FAF4E6` | Secondary light surface |
| Muted green | `#a9c0ad` | Secondary text on dark surfaces |
| Muted tan | `#7a6f54` | Secondary text on light surfaces |

### Typography
| Family | Role | Weights |
|---|---|---|
| **Alfa Slab One** (Google Fonts) | Display — identity, team names, hero scores, primary buttons | 400 |
| **Saira Condensed** (Google Fonts) | Athletic labels, scorebug numerals, tab bars, secondary buttons | 400, 500, 600, 700, 800 |
| **Archivo** (Google Fonts) | Data — play-by-play, rosters, box scores, body copy | 400, 500, 600, 700 |

### Spacing & Shape
- Border radius: **0** everywhere (flat, hard corners — this is intentional and brand-defining)
- Borders: `2px solid #1A2A4A` on light surfaces; `2px solid #C9A14A` on dark surfaces
- No box shadows (except the strike-type popup which uses `6px 6px 0 #1A2A4A` — a hard offset, not a blur)

### Patriotic Bunting
The header bunting is an SVG tiling pattern of fan-rosette scallops: red/white/red/white concentric arc bands with a navy canton of white stars. Used at the top of: cover/home screen, Final (box score) screen, and Starting Soon screen. See the spec HTML for the exact SVG `<pattern>` definition.

---

## Surfaces / Screens

### 1. Scorer Console (`/score`)

The cockpit. Designed for one-handed use in sunlight. Always has: scoreboard header → batter strip → field/content → undo strip → action buttons.

#### State 1 — Live At-Bat (default)
**Layout:** Flex column, 382px wide, fills phone height.

**Scoreboard header** (dark green `#1E3A24`, `font-family: Saira Condensed`):
- Two rows: away team left / home team right, separated by vertical rule
- Each row: team code (21px 600) left, score (26px 700) right
- Bottom strip: inning (▼6), count (2–1 B–S), outs (filled/empty circles 11px), diamond runner indicator (SVG)
- Home team row background: `#244129`, team code in gold

**Batter/Pitcher strip** (cream `#F4ECD8`):
- Two columns separated by `1px rgba(26,42,74,.2)` rule
- Left: "AT BAT" label (10px Saira 600, barn red, `letter-spacing:.14em`) + player name (18px Alfa Slab, navy) + stats (11px Archivo, muted tan)
- Right: "PITCHING" label + pitcher name + pitch count

**Field area** (`flex:1`, fills remaining space, `background:#2C5234`):
- Header strip (dark green): "RUNNERS ON · 1ST & 3RD" left + "tap runner ▸ advance · drag ▸ steal" hint right
- SVG diamond field below — see Field Component spec below

**AB pitch log** (cream `#FAF4E6`): "AB" label + pitch chips (26×26px squares: S=barn red, B=board green, F=barn red)

**Undo strip** (`background:#C9A14A`, `border-top:2px solid #1A2A4A`):
- Left: "↶ UNDO — [last action]" (Saira 600, 13px, navy)
- Right: "EDIT" (Saira 600, 12px, dark gold) | divider | "END ▸" (Saira 700, 12px, barn red)
- Tapping END ▸ raises End Game confirmation popup

**Action zone** (`background:#1A2A4A`, `padding:14px`, `gap:10px`):
- Row 1: BALL (green `#2C5234`, h:74px) | STRIKE (red `#A6342E`, h:74px) — equal columns
- Row 2: FOUL (outlined gold, h:58px) | HBP (outlined cream, h:58px) | IN PLAY ▸ (gold fill, h:58px, 1.4fr) — Alfa Slab font all

#### State 1b — Strike Type Popup
Centered popup over dimmed cockpit. `border:3px solid #A6342E`, `box-shadow:6px 6px 0 #1A2A4A`.
- Red header bar: "Strike — what kind?" + ✕
- Count context strip: "COUNT 2–1 → 2–2"
- Three buttons: SWINGING (full red, h:58px) | LOOKING (outlined navy, h:58px) | FOUL TIP (tertiary, h:46px, Saira 700)
- Footer note: "On a 3rd strike: swinging = K · looking = ꓘ"

#### State 2 — Ball in Play: Locate + Credit
Two-part flow:
1. **Zone-tap spray field**: Field SVG divided into tappable zones (LF/CF/RF outfield wedges + infield labels). Selected zone highlighted gold with dashed spray line from home. Ball landing marker: white circle with gold stroke.
2. **Fielder credit grid**: 2 rows of 5 position buttons (1–9 + ADD). Each button: position number (15px Alfa Slab) + position name (8px Saira). Selected = gold fill. Tap in order to build putout sequence (e.g. 6–4–3).
- Result chips above grid: 1B, 2B, GO, DP (tap to select)
- RBI stepper: − | count | +
- Confirm button: "CONFIRM 6–4–3 DP ▸" (green)

#### State 2c — Mid-Inning Sub
Type selector tabs: P / PH / PR (pitcher, pinch hit, pinch run).

**Pitcher change (P selected)**:
- LEAVING row: jersey number (22px barn red) + player name (16px Alfa Slab) + full line (11px Archivo) + W/L/ND decision taps
- ENTERING: bench roster cards — jersey + name + handedness + pitch count. Selected = navy background + gold border + "✓ selected"
- Defensive re-alignment: optional inline position dropdowns for affected lineup rows
- Bottom: CANCEL + CONFIRM SUB ▸

#### State 3 — Runner Advancement
Flat field with advance arrows showing runner movement. Drag arrows to adjust. HOLD ALL | CONFIRM ▸ buttons.

#### State 4 — Between Innings
Full dark green screen centered: stitched ball SVG + "MIDDLE OF THE 6TH" (Alfa Slab 34px) + score + "DUE UP" list.
Bottom: START BOTTOM 6TH ▸ (gold CTA, h:64px) | SUBSTITUTION / LINEUP (outlined) | END GAME EARLY ▸ (outlined barn red, h:40px, Saira 700)

#### State 4b — End Game Confirmation Popup
Centered popup over dimmed between-innings screen.
- Red header: "End game early?"
- Four reason radio options (tap to select): Time limit reached (pre-selected) / Mercy rule / Weather-forfeit / Other
- Selected state: navy background + gold dot
- CANCEL + END & RECORD FINAL ▸ (barn red)

#### State 5 — Sunlight / High Contrast
Same layout but all colors boosted: pure black borders, `#0E1A30` header, `#FFD24A` gold, larger numerals (32px scores), bigger buttons (h:96px BALL/STRIKE). For accessibility in bright daylight.

#### Simple Mode (Quick Scoring toggle)
Toggle in gold banner strip: "QUICK SCORING · Stats incomplete · tap to switch to full scoring"
Four giant equal buttons filling the full lower area:
- BALL (green) | STRIKE (red) — top row
- HIT (cream/navy) | OUT (navy + gold border) — bottom row
All buttons: Alfa Slab 28px, no padding, equal flex.

#### Tablet Landscape Layout
Split view: left panel (430px) = live state + field + undo; right panel (flex:1, `background:#1A2A4A`) = all action buttons visible simultaneously (BALL/STRIKE large + FOUL/SUB + in-play grid 4-col + stream sync scrubber). No digging required.

---

### 2. Viewer (`/watch`)

Lean-back experience. Three layout modes share the same shell.

#### Shell Structure (Video Present)
```
[Status bar]
[Video — 200px fixed, always pinned top]
[Score panel — fixed]
[Tab bar: FIELD | PLAYS | BOX | STATS]
[Scrollable content area — flex:1]
```

**Video area** (200px, `background` = video or dark green placeholder):
- LIVE badge top-left: barn red, pulsing white dot, "LIVE" Saira 600 `letter-spacing:.18em`
- Fullscreen icon top-right
- AI Commentary toggle bottom-right: dark translucent background + gold border

**Score panel** (`background:#1E3A24`, `border-top/bottom:2px solid #C9A14A`):
- Two rows: team badge (navy or gold pill with 3-letter code) + full team name + score (right)
- Share icon button on home team row (gold border, 32×32px)
- Bottom strip (`background:#15281b`): inning, count, outs, diamond runner SVG

**Tab bar** (`background:#122019`): FIELD | PLAYS | BOX | STATS — Saira 600 12px `letter-spacing:.08em`. Active tab has 30×3px gold underline.

#### Field Tab (default)
Live play banner (barn red): "▸ [PLAY DESCRIPTION] · [player detail]"
Full field SVG — see Field Component spec.

#### Plays Tab
Play-by-play feed. Each row: inning label (Saira 600, colored by context) + play description (Archivo 12.5px). Inning label colors: barn red = scoring, board green = strikeout, muted tan = neutral.

#### Box Tab
Line score grid: team name | innings 1–7 | R | H | E. Current inning column in gold. In-progress innings show "–". R column bold. Home team R in gold.

#### Stats Tab
**Team totals** grid: 3-column (GFS stat OAK), rows: Team AVG, Hits, Runners LOB, Errors.
**Top Performers** list: team badge + player name (Alfa Slab 14px) + stat line (right).
**Pitching** list: same format.

#### Stats-Only Mode (no video)
Hero scoreboard (`border:3px solid #C9A14A`) replaces video, same tab content below.

#### Final Screen
Bunting SVG at top. Centered "FINAL" badge (barn red, `letter-spacing:.3em`).
Big final scores side-by-side with "—" divider.
Line score grid below (newspaper style, columns layout).
Game Leaders in two-column newspaper layout (Archivo 12px).
Bottom: FULL BOX | SHARE ▸

#### Starting Soon
Full dark navy screen: stitched ball SVG + "FIRST PITCH" label + team names (Alfa Slab) + time (gold bordered box) + location/date + "WAITING FOR STREAM" indicator.

#### Desktop / TV Layout
Horizontal split: video left (flex:1) with scorebug overlay bottom-left + side panel right (330px, `background:#FAF4E6`, `border-left:3px solid #C9A14A`) with now batting + play-by-play feed.

---

### 3. Setup (`/setup`)

#### Lineup Scan Review (hero screen)
Horizontal split (1000px wide, 620px tall — or full screen on mobile as a modal):

**Left panel** (380px, `background:#FAF4E6`):
- Header: "SCANNED CARD" + ↻ RESCAN
- Faux handwritten lineup card (white card, slight rotation, `box-shadow:0 1px 0 #c7bfa6`)
- Row highlighting for uncertain reads (yellow background `#fdf3d6`)

**Right panel** (flex:1):
- "Here's what we read" heading (Alfa Slab 22px) + flagged count (barn red)
- Table: # | PLAYER | POS | BATS | NO.
- Normal rows: Archivo 14px navy
- Flagged rows: `background:#fbf0d2`, `border-left:4px solid #C9A14A` — inline text input with "CHECK SPELLING" hint
- Bottom: DISCARD | CONFIRM & SAVE LINEUP ▸ (green)

#### Roster Screen
Team identity header (team circle icon + name Alfa Slab + division/count).
Player list: jersey number (barn red, Saira 700 20px) + full name (Alfa Slab 15px) + position/bats/throws (Archivo 11px). Dividers `1px rgba(26,42,74,.12)`.
Bottom: + ADD PLAYER (gold CTA).

#### Create Game
Matchup selector: away (white box) — "at" — home (navy box, gold text).
Video source grid (2×2): None / This phone ✓ / External / YouTube. Selected = board green background + gold border + checkmark.
Field & Time: single text row.
Bottom: CREATE & GO TO LINEUP ▸ (gold CTA).

---

### 4. Share

**From scorer** (mid-game bottom sheet):
- "Share this game" header + ✕
- Triggers **native iOS/Android share sheet** — `navigator.share({url: 'https://bpw.live/[slug]'})` or platform equivalent
- Below native sheet: "Show QR Code" row (navy QR icon, caption "Parents scan at the field")

**Share icon placement**: in the score panel's home team row (bottom right), 32×32px button with gold border. Does NOT obstruct video.

**From viewer**: same share icon in score panel triggers native share. Gold toast confirmation banner below score panel on success: "Link copied! · bpw.live/oak-gfs-0621 · no account needed" + QR button.

**Link format**: `bpw.live/<away-home-mmdd>` — short enough for any messaging app.
**No account required** to view. Link persists after game as the final box score URL.

---

## Field Component (shared across Scorer + Viewer)

Used in: Scorer State 1, Scorer State 2 (spray), Viewer Field tab, LiveTabs component.

### Geometry (all fields use same proportions)
Diamond is a **perfect square rotated 45°**. All four sides equal length.

**Coordinate system** (300×300 SVG space, centered at `cx,cy`):
- half = `h` (same value for x and y)
- Home: `(cx, cy+h)`
- 1B: `(cx+h, cy)`
- 2B: `(cx, cy-h)`
- 3B: `(cx-h, cy)`

**In the Scorer State 1 field**: `cx=150, cy=168, h=88` → Home=(150,256), 1B=(238,168), 2B=(150,80), 3B=(62,168).

### Visual layers (bottom to top)
1. **Background rect**: `#2C5234` (board green)
2. **Outfield crescent**: elliptical arc `rx≈110 ry≈36`, fills gap between foul lines above 2B, `fill:#326139` (lighter green band)
3. **Infield dirt**: outer diamond polygon, `fill:#b07a3e`
4. **Infield grass**: inner diamond (subtract ~12px from each vertex toward center), `fill:#2C5234`
5. **Base paths**: outer diamond outline, `stroke:#e9ddc2, stroke-width:2.5`
6. **Pitcher's mound**: circle r≈12 at field center, `fill:#b07a3e` + rubber rect `fill:#F4ECD8`
7. **Bases**: 14×14px rects rotated 45°. 2B=cream; 1B+3B=gold (occupied by runners); home=pentagon shape cream
8. **Runner chips**: gold circles (r=13-14) at base positions with navy labels below
9. **Batter chip**: barn red circle (r=9-10) at home + optional label pill
10. **Ball path**: dashed white/gold line with arrowhead marker
11. **Fielder dots** (viewer): navy circles with position text, white name text with green `paint-order:stroke` outline

### No foul lines
Do NOT draw explicit foul line elements — the diamond base path edges already communicate them visually. Adding separate foul lines creates a double-line artifact.

### Spray zones (State 2 only)
Three outfield wedge paths (LF/CF/RF) anchored at home, fanning to the outfield arc. Normal: `fill:rgba(244,236,216,.08), stroke:rgba(244,236,216,.25)`. Selected zone: `fill:rgba(201,161,74,.35), stroke:#C9A14A`. Infield zone labels (SS/2B/3B/1B/P) as SVG text inside the diamond at their approximate field positions.

---

## Scorebug Component

Used inline in video overlays and as a standalone hero.

**Overlay (compact)**: flex row of panels, `background:#1E3A24, border:2px solid #C9A14A`.
- Team/score column (min-width ~90px): two rows, each row = team code (Saira 600 14-18px) + score (Saira 700 15-20px tabular nums). Home team in gold.
- Inning panel: `border-left:2px solid #C9A14A` — inning indicator (▼6) + BOT label
- Count panel: `border-left:1px solid rgba(...)` — B–S count
- Outs panel: row of 3 circles (9px), filled barn red = out, outlined cream = safe
- Diamond runner panel: small SVG diamond with gold-filled bases for occupied

**Hero (stats-only / no video)**: same grammar, scaled up. Full line score grid added between team rows and bottom strip.

---

## Interactions & Behavior

### Scorer
- **BALL/STRIKE**: tap → immediately increments count. On 3rd strike: pop the Strike Type popup (swinging/looking/foul tip) to determine K vs ꓘ.
- **FOUL**: increments strike count, never a third strike on foul
- **HBP**: batter advances to 1B, no count change, go to runner resolution
- **IN PLAY ▸**: opens ball-in-play flow (zone tap → fielder credit → runner resolution → confirm)
- **Undo strip**: always shows the last action taken. Tapping ↶ UNDO reverts that one action. EDIT opens full play editor.
- **END ▸**: opens end game confirmation popup. Available mid-at-bat and between innings.
- **Runner advance**: tap runner circle to advance one base; drag to arbitrary base; "STEAL 2B?" tooltip appears when runner is on 1B
- **Simple mode toggle**: stores preference in localStorage, persists across sessions

### Viewer
- Tab switching: FIELD / PLAYS / BOX / STATS — swipe or tap
- Share button: calls `navigator.share()` on mobile; falls back to copy-to-clipboard on desktop with toast
- AI Commentary: toggle on/off, preference persists

### Share
- Link: `https://bpw.live/<slug>` — no auth required for viewers
- QR code: generate from link using `qrcode` library or similar
- Post-game: same link resolves to final box score page

---

## State Management

| State | Location | Notes |
|---|---|---|
| Current score | Server-synced | Real-time via WebSocket |
| At-bat count (B/S) | Local + server | Optimistic update, reconcile on confirm |
| Undo stack | Local (last 10 actions) | Clear on inning change |
| Game mode (simple/full) | localStorage | Persists |
| Active tab (viewer) | Component state | Reset on new game |
| Live stream URL | Server | Provided at game creation |

---

## Assets
- **Fonts**: Alfa Slab One, Saira Condensed, Archivo — all available on Google Fonts, load via CDN or bundle
- **Bunting SVG**: defined as `<pattern id="usbunt">` in the spec HTML — extract and use as SVG background image or Canvas draw
- **Ball/diamond/pennant motifs**: flat SVG icons defined inline in the spec, extract as SVG files
- **No external image dependencies** — all field art, badges, and motifs are SVG

---

## Files in This Package
| File | Contents |
|---|---|
| `Ballpark Watch Visual Spec.html` | Full visual spec — all screens, all states, design system section |
| `LiveTabs Reference.html` | Interactive viewer tab component (working tab switching) |
| `product-brief.md` | Original product brief with technical architecture and feature requirements |
| `README.md` | This document |

---

## Implementation Notes

1. **React Native** is recommended for the mobile scorer and viewer apps (iOS + Android). The web viewer (share link) can be React.
2. The scorer console should be a **native app** — the latency and reliability of web during live scoring is a risk.
3. The field SVG works well as a React component with props for `runners` (array of base positions) and `fielders` (array of position/name).
4. The scorebug is a strong candidate for a shared component library (used in 5+ surfaces).
5. Real-time sync: WebSocket or Server-Sent Events for score updates to viewers. Scorer writes locally first (optimistic), confirms to server on each pitch.
6. The "no-account viewer" pattern means the share link must work without cookies or auth headers — serve a public read-only game state endpoint.
