// Bandbox recorder-manager (Railway service) — GStreamer WHEP capture (re-encode).
//
// Records the PAID full-quality replay by pulling the game's Cloudflare WHEP feed with
// record.py (GStreamer whepsrc → x264enc mp4) and writing it to a file — no headless
// browser. On the broadcast's
// go-live the edge function POSTs { gameId, token } here; we wait for the game to go live,
// run record.py until it goes final (or the feed stops), then upload the file into
// Cloudflare Stream and point the game's replay at it.
//
// Env: RECORDER_SECRET (bearer auth), SUPABASE_URL, SUPABASE_ANON_KEY, MAX_MINUTES, PORT.

import express from 'express'
import { spawn, execFile } from 'node:child_process'
import { stat, open, unlink } from 'node:fs/promises'

// Normalize the raw recording for universal playback (esp. iOS Safari):
//  - moov atom to the FRONT (+faststart) so progressive download plays immediately
//  - trim the leading audio-only gap (before the first video keyframe) so the file starts
//    on real video with NO empty edit list (Safari mishandles empty edits → black + drift)
// ssMs = length of that leading gap (the first encoded frame's PTS). Resolves true on success.
function normalizeMp4(inFile, outFile, ssMs) {
  const args = ['-y']
  if (ssMs > 500) args.push('-ss', (ssMs / 1000).toFixed(3))
  args.push('-i', inFile, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', outFile)
  return new Promise((resolve) => {
    execFile('ffmpeg', args, { timeout: 300_000 }, (err, _out, stderr) => {
      if (err) {
        console.error('[ffmpeg] failed:', String(stderr || err).slice(-300))
        resolve(false)
      } else resolve(true)
    })
  })
}

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.message || e))
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.message || e))

const PORT = process.env.PORT || 3000
const SECRET = process.env.RECORDER_SECRET || ''
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const ANON = process.env.SUPABASE_ANON_KEY || ''
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 240)
const CF_TURN_KEY_ID = process.env.CF_TURN_KEY_ID || ''
const CF_TURN_API_TOKEN = process.env.CF_TURN_API_TOKEN || ''

// Mint short-lived Cloudflare TURN credentials for the recorder's WHEP connection. The free
// openrelay TURN dropped connections mid-recording ("Internal data stream error"); Cloudflare's
// TURN (same network as Stream) is reliable. Returns { username, credential } or null.
async function getCfTurn() {
  if (!CF_TURN_KEY_ID || !CF_TURN_API_TOKEN) return null
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    })
    if (!res.ok) {
      console.error('[turn] cloudflare error', res.status)
      return null
    }
    const ice = (await res.json())?.iceServers || {}
    if (!ice.username || !ice.credential) return null
    return { username: ice.username, credential: ice.credential }
  } catch (e) {
    console.error('[turn] cloudflare fetch failed', e?.message || e)
    return null
  }
}

const active = new Map() // gameId -> { proc }
const recent = [] // last outcomes, newest first (diagnostics via /health)
const remember = (gameId, state) => {
  recent.unshift({ gameId, at: new Date().toISOString(), ...state })
  if (recent.length > 12) recent.pop()
}
// Ring buffer of the record.py pipeline logs, surfaced via /health so we can read what the
// GStreamer pipeline actually did (caps, keyframes, encoded-frame count) without Railway access.
const pylog = []
const logline = (gameId, line) => {
  pylog.unshift({ gameId, at: new Date().toISOString(), line })
  if (pylog.length > 60) pylog.pop()
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


async function uploadToSupabase(token, gameId, startedAt, file, size) {
  const path = `recordings/${gameId}/${startedAt}/full.mp4`
  const signRes = await fetch(`${SUPABASE_URL}/functions/v1/sign-upload`, {
    method: 'POST',
    headers: sbHeaders(false),
    body: JSON.stringify({ token, path }),
  })
  const sign = await signRes.json().catch(() => ({}))
  if (!signRes.ok || !sign.token) throw new Error(`sign-upload ${signRes.status}: ${sign.error || ''}`)
  const { createReadStream } = await import('node:fs')
  const putUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/bpw-video/${sign.path || path}?token=${sign.token}`
  const put = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'x-upsert': 'true',
    },
    body: createReadStream(file),
    duplex: 'half',
  })
  if (!put.ok) throw new Error(`storage PUT ${put.status}: ${(await put.text().catch(() => '')).slice(0, 200)}`)
  return path
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
  let videoStartMs = 0 // leading audio-only gap before first video keyframe (ffmpeg trims it)
  let gotVideo = false // did any video frame encode? (false → don't save an audio-only spinner)
  let liveAt = 0 // wall-clock when the game first went 'live' — the replay is trimmed to here
    //           so NO pre-game footage is ever served to viewers.
  try {
    // 1. Start capturing as soon as the WHEP feed exists — do NOT wait for the game to go
    //    'live'. start-recording is triggered when the broadcast connects (often before the
    //    scorer starts the game), so connecting now warms up the WebRTC path and gets the first
    //    keyframe during PRE-GAME. That way the opening of the game already has video instead of
    //    ~11s of keyframe-wait eating the first pitch. Pre-game footage is skipped by the replay.
    let whep = null
    const liveDeadline = Date.now() + 10 * 60_000
    while (Date.now() < liveDeadline) {
      const g = await getGame(gameId).catch(() => null)
      if (g?.status === 'final') {
        remember(gameId, { status: 'error', detail: 'game final before capture' })
        return
      }
      if (g?.cf_whep_url) {
        whep = g.cf_whep_url
        break
      }
      await sleep(2000)
    }
    if (!whep) {
      remember(gameId, { status: 'error', detail: 'no whep url' })
      return
    }

    // 2. Start the capture (aiortc receives the WHEP track and records it to file).
    file = `/tmp/rec-${gameId}-${Date.now()}.mp4`
    startedAt = Date.now()
    console.log('[rec] start capture', gameId, whep)
    const spawnEnv = { ...process.env, GST_DEBUG: '1' }
    const turn = await getCfTurn()
    if (turn) {
      spawnEnv.RECORDER_STUN = 'stun://stun.cloudflare.com:3478'
      spawnEnv.RECORDER_TURN = `turn://${turn.username}:${turn.credential}@turn.cloudflare.com:3478?transport=udp`
      console.log('[rec] using Cloudflare TURN')
    } else {
      console.log('[rec] no Cloudflare TURN configured — falling back to openrelay')
    }
    proc = spawn('python3', ['record.py', whep, file], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    })
    active.set(gameId, { proc })
    const capture = (tag) => (d) => {
      const s = String(d).trim()
      console.log(`[py ${gameId}${tag}]`, s)
      for (const ln of s.split('\n')) {
        if (!ln.trim()) continue
        logline(gameId, tag ? `[err] ${ln.trim()}` : ln.trim())
        const m = ln.match(/VIDEO_START_MS=(\d+)/)
        if (m) {
          videoStartMs = Number(m[1])
          gotVideo = true
        }
      }
    }
    proc.stdout.on('data', capture(''))
    proc.stderr.on('data', capture(' err'))
    proc.on('exit', (code) => {
      procExited = true
      console.log(`[py ${gameId}] exited`, code)
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
      if (size > lastSize) lastSize = size
      remember(gameId, { status: 'recording', bytes: size })
      // Do NOT stop on file-size stall — aiortc buffers the webm and flushes in bursts, so
      // the on-disk size doesn't grow smoothly (that false-stopped mid-game). Finish only on
      // the game going final, the recorder process exiting (feed truly dropped), or the cap.
      const g = await getGame(gameId).catch(() => null)
      if (g?.status === 'live' && !liveAt) {
        liveAt = Date.now()
        console.log(`[rec ${gameId}] game went live — replay trims to here`)
      }
      if (g?.status === 'final') {
        console.log(`[rec ${gameId}] game final`)
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
      // Wait for the recorder to finish EOS + write the mp4 moov before uploading (don't
      // upload a half-finalized file). Longer window for larger recordings.
      for (let i = 0; i < 120 && !procExited; i++) await sleep(500)
    }

    // 5. Upload the recording to Supabase and serve the mp4 DIRECTLY (the browser plays it,
    //    no Cloudflare transcode). The re-encoded H.264/AAC mp4 is a standard file that plays
    //    in Safari and would also be CF-ingestable if we later want the CDN/HLS path.
    const rawSize = (await stat(file)).size
    if (!rawSize) {
      remember(gameId, { status: 'error', detail: 'empty recording' })
      return
    }
    if (!gotVideo) {
      // Audio-only capture (no keyframe ever arrived). Saving this would give viewers a
      // spinning, never-loading video. Skip it — better no replay than a broken one.
      console.log('[rec] no video frames, skipping save', gameId)
      remember(gameId, { status: 'error', detail: 'no video frames (no keyframe)' })
      return
    }

    // Normalize for iOS/Safari: faststart (moov at front) + trim the leading pre-video gap so
    // the file opens on real video with no empty edit list. On success the file starts at the
    // first video frame, so recording_started_at (the replay anchor) shifts forward by
    // videoStartMs to keep plays aligned. Fall back to the raw file if ffmpeg isn't happy.
    let uploadFile = file
    let anchorMs = startedAt
    // Trim the served file to GAME-START so viewers never see pre-game footage. Cut point =
    // max(when the game went live, first-keyframe) — never before video exists. Guard so we
    // never seek past the end (→ empty file). If we can't compute a sane cut, just faststart.
    const totalMs = Date.now() - startedAt
    const gameStartMs = liveAt ? liveAt - startedAt : 0
    let trimMs = Math.max(videoStartMs > 500 ? videoStartMs : 0, gameStartMs)
    if (!(trimMs > 500 && trimMs < totalMs - 2000)) trimMs = 0
    const webFile = file.replace(/\.mp4$/, '-web.mp4')
    console.log('[rec] normalizing', gameId, 'videoStartMs=', videoStartMs, 'gameStartMs=', gameStartMs, 'trimMs=', trimMs)
    if (await normalizeMp4(file, webFile, trimMs)) {
      const ws = await stat(webFile).catch(() => null)
      if (ws && ws.size > 1000) {
        uploadFile = webFile
        if (trimMs) anchorMs = startedAt + trimMs
      }
    }
    const size = (await stat(uploadFile)).size
    console.log('[rec] uploading', gameId, size, 'bytes', uploadFile === webFile ? '(web)' : '(raw)')
    const spath = await uploadToSupabase(token, gameId, startedAt, uploadFile, size)
    await rpc('save_recording', {
      p_token: token,
      p_path: spath,
      p_started_at: new Date(anchorMs).toISOString(),
      p_duration_ms: Math.max(0, Date.now() - anchorMs),
      p_mime: 'video/mp4',
      p_segments: null,
    })
    unlink(webFile).catch(() => {})
    console.log('[rec] done', gameId, spath)
    remember(gameId, { status: 'done', bytes: size, detail: spath })
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
app.get('/health', (_req, res) => res.json({ ok: true, active: [...active.keys()], recent, pylog }))
app.post('/record', (req, res) => {
  if (!SECRET || req.headers.authorization !== `Bearer ${SECRET}`) return res.status(403).json({ error: 'forbidden' })
  const { gameId, token } = req.body || {}
  if (!gameId || !token) return res.status(400).json({ error: 'missing gameId or token' })
  void recordGame(gameId, token) // fire-and-forget; errors handled inside
  res.json({ ok: true })
})
app.listen(PORT, () => console.log(`[rec] gstreamer recorder listening on ${PORT}, supabase ${SUPABASE_URL ? 'set' : 'MISSING'}`))
