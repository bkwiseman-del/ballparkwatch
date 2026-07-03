// Bandbox recorder-manager (Railway service) — GStreamer WHEP capture.
//
// Records the PAID full-quality replay by pulling the game's Cloudflare WHEP feed with a
// native GStreamer pipeline (whepsrc) and copying it to a file — no headless browser, no
// re-encode. On the broadcast's go-live the edge function POSTs { gameId, token } here; we
// wait for the game to go live, run the capture until it goes final (or the feed stops),
// then upload the file into Cloudflare Stream and point the game's replay at it.
//
// Env: RECORDER_SECRET (bearer auth), SUPABASE_URL, SUPABASE_ANON_KEY, MAX_MINUTES, PORT.

import express from 'express'
import { spawn } from 'node:child_process'
import { stat, open, unlink } from 'node:fs/promises'

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.message || e))
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.message || e))

const PORT = process.env.PORT || 3000
const SECRET = process.env.RECORDER_SECRET || ''
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const ANON = process.env.SUPABASE_ANON_KEY || ''
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 240)

const active = new Map() // gameId -> { proc }
const recent = [] // last outcomes, newest first (diagnostics via /health)
const remember = (gameId, state) => {
  recent.unshift({ gameId, at: new Date().toISOString(), ...state })
  if (recent.length > 12) recent.pop()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- Supabase (call as the anon role + the broadcast token, same as the browser did) ---
const sbHeaders = (profile) => ({
  apikey: ANON,
  Authorization: `Bearer ${ANON}`,
  'Content-Type': 'application/json',
  ...(profile ? { 'Content-Profile': 'bpw', 'Accept-Profile': 'bpw' } : {}),
})
async function getGame(gameId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_game`, {
    method: 'POST',
    headers: sbHeaders(true),
    body: JSON.stringify({ p_game_id: gameId }),
  })
  if (!res.ok) throw new Error(`get_public_game ${res.status}`)
  return res.json()
}
async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: sbHeaders(true),
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`rpc ${name} ${res.status}`)
  return res.status === 204 ? null : res.json().catch(() => null)
}
async function streamLive(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/stream-live`, {
    method: 'POST',
    headers: sbHeaders(false),
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`stream-live ${res.status}: ${j.error || ''}`)
  return j
}

// GStreamer pipeline: pull WHEP, copy H.264 video + Opus audio into Matroska (no re-encode).
// Cloudflare transcodes on upload, so the container just needs intact elementary streams.
function pipelineArgs(whep, file) {
  return [
    '-e',
    'whepsrc',
    'name=w',
    `whep-endpoint=${whep}`,
    'w.',
    '!',
    'application/x-rtp,media=video',
    '!',
    'rtph264depay',
    '!',
    'h264parse',
    '!',
    'queue',
    '!',
    'mux.',
    'w.',
    '!',
    'application/x-rtp,media=audio',
    '!',
    'rtpopusdepay',
    '!',
    'opusparse',
    '!',
    'queue',
    '!',
    'mux.',
    'matroskamux',
    'name=mux',
    '!',
    'filesink',
    `location=${file}`,
  ]
}

async function uploadToCloudflare(token, file, size) {
  const { uploadUrl, uid } = await streamLive({ token, action: 'upload-init', uploadLength: size })
  if (!uploadUrl || !uid) throw new Error('upload-init returned no url')
  const CHUNK = 32 * 1024 * 1024 // 32 MiB (multiple of 256 KiB, Cloudflare tus requirement)
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(CHUNK)
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - offset), offset)
      const body = buf.subarray(0, bytesRead)
      let ok = false
      for (let a = 0; a < 4; a++) {
        const res = await fetch(uploadUrl, {
          method: 'PATCH',
          headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
          body,
        })
        if (res.ok) {
          ok = true
          break
        }
        await sleep(800)
      }
      if (!ok) throw new Error(`tus patch failed at offset ${offset}`)
      offset += bytesRead
    }
  } finally {
    await fh.close()
  }
  return uid
}

async function recordGame(gameId, token) {
  if (active.has(gameId)) {
    console.log('[rec] already recording', gameId)
    return
  }
  active.set(gameId, { proc: null })
  console.log('[rec] queued', gameId)
  remember(gameId, { status: 'launched' })
  let proc = null
  let procExited = false
  let file = null
  let startedAt = 0
  try {
    // 1. Wait for the game to go live and expose a WHEP url.
    let whep = null
    const liveDeadline = Date.now() + 10 * 60_000
    while (Date.now() < liveDeadline) {
      const g = await getGame(gameId).catch(() => null)
      if (g?.status === 'final') {
        remember(gameId, { status: 'error', detail: 'game final before live' })
        return
      }
      if (g?.status === 'live' && g?.cf_whep_url) {
        whep = g.cf_whep_url
        break
      }
      await sleep(2000)
    }
    if (!whep) {
      remember(gameId, { status: 'error', detail: 'never went live' })
      return
    }

    // 2. Start the capture.
    file = `/tmp/rec-${gameId}-${Date.now()}.mkv`
    startedAt = Date.now()
    console.log('[rec] start capture', gameId, whep)
    proc = spawn('gst-launch-1.0', pipelineArgs(whep, file), { stdio: ['ignore', 'pipe', 'pipe'] })
    active.set(gameId, { proc })
    proc.stdout.on('data', (d) => console.log(`[gst ${gameId}]`, String(d).trim()))
    proc.stderr.on('data', (d) => console.log(`[gst ${gameId} err]`, String(d).trim()))
    proc.on('exit', (code) => {
      procExited = true
      console.log(`[gst ${gameId}] exited`, code)
    })
    remember(gameId, { status: 'recording', bytes: 0 })

    // 3. Run until final / feed stops (file stops growing) / process exits / safety cap.
    const maxDeadline = Date.now() + MAX_MINUTES * 60_000
    let lastSize = 0
    let lastGrow = Date.now()
    while (true) {
      await sleep(5000)
      if (procExited) break
      if (Date.now() > maxDeadline) break
      let size = 0
      try {
        size = (await stat(file)).size
      } catch {
        /* not created yet */
      }
      if (size > lastSize) {
        lastSize = size
        lastGrow = Date.now()
      }
      remember(gameId, { status: 'recording', bytes: size })
      if (Date.now() - lastGrow > 30_000) {
        console.log(`[gst ${gameId}] file stalled — feed ended`)
        break
      }
      const g = await getGame(gameId).catch(() => null)
      if (g?.status === 'final') {
        console.log(`[gst ${gameId}] game final`)
        break
      }
    }

    // 4. Stop GStreamer gracefully (SIGINT → EOS) so the container is finalized.
    remember(gameId, { status: 'saving', bytes: lastSize })
    if (proc && !procExited) {
      try {
        proc.kill('SIGINT')
      } catch {
        /* ignore */
      }
      for (let i = 0; i < 24 && !procExited; i++) await sleep(500)
    }

    // 5. Upload to Cloudflare Stream + point the replay at it.
    const size = (await stat(file)).size.valueOf()
    if (!size) {
      remember(gameId, { status: 'error', detail: 'empty recording' })
      return
    }
    console.log('[rec] uploading', gameId, size, 'bytes')
    const uid = await uploadToCloudflare(token, file, size)
    // Anchor the replay clock to when capture started (WHEP is sub-second).
    await rpc('save_recording', {
      p_token: token,
      p_path: null,
      p_started_at: new Date(startedAt).toISOString(),
      p_duration_ms: Date.now() - startedAt,
      p_mime: 'video/mp4',
      p_segments: null,
    }).catch((e) => console.error('[rec] save_recording', e?.message))
    await streamLive({ token, action: 'set-recording', recordingUid: uid })
    console.log('[rec] done', gameId, uid)
    remember(gameId, { status: 'done', bytes: size, detail: uid })
  } catch (e) {
    console.error('[rec] error', gameId, e?.message || e)
    remember(gameId, { status: 'error', detail: String(e?.message || e) })
  } finally {
    try {
      if (proc && proc.exitCode === null) proc.kill('SIGKILL')
    } catch {
      /* ignore */
    }
    if (file) unlink(file).catch(() => {})
    active.delete(gameId)
    console.log('[rec] end', gameId)
  }
}

const app = express()
app.use(express.json())
app.get('/health', (_req, res) => res.json({ ok: true, active: [...active.keys()], recent }))
app.post('/record', (req, res) => {
  if (!SECRET || req.headers.authorization !== `Bearer ${SECRET}`) return res.status(403).json({ error: 'forbidden' })
  const { gameId, token } = req.body || {}
  if (!gameId || !token) return res.status(400).json({ error: 'missing gameId or token' })
  void recordGame(gameId, token) // fire-and-forget; errors handled inside
  res.json({ ok: true })
})
app.listen(PORT, () => console.log(`[rec] gstreamer recorder listening on ${PORT}, supabase ${SUPABASE_URL ? 'set' : 'MISSING'}`))
