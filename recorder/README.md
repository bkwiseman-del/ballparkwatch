# Bandbox recorder-manager

Headless-Chrome service that records the **paid** full-quality replay. It opens
`APP_ORIGIN/record/:gameId?token=…` (the recorder page in the app), which joins the live
WHEP feed and uploads the recording. One page per concurrent game.

Deployed on **Railway** (its own service; the frontend stays on Vercel).

## Env vars (set in Railway)
- `RECORDER_SECRET` — a long random string; the edge function sends it as `Bearer` auth.
- `APP_ORIGIN` — `https://bandbox.tv`
- `MAX_MINUTES` — optional safety cap (default 240)
- `PORT` — Railway sets this automatically.

## Endpoints
- `POST /record` (auth: `Authorization: Bearer $RECORDER_SECRET`) body `{ gameId, token }`
  → starts a background recording. Fire-and-forget.
- `GET /health` → `{ ok, active: [gameIds] }`

## Deploy (Railway)
New project → Deploy from GitHub → this repo → **Root Directory = `recorder`** → Railway
builds the Dockerfile → set the env vars → generate a public domain.
