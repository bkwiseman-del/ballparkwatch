// Bandbox recorder-manager (Railway service).
//
// Long-lived Node service that records the PAID full-quality replay. The Supabase edge
// function POSTs { gameId, token } here on a paid broadcast's go-live; we open a headless
// Chrome page at APP_ORIGIN/record/:gameId?token=... (the recorder page does the actual
// WHEP capture + upload) and keep it alive until the page reports done, then close it.
// One browser, one page per concurrent game — so a beefy instance handles several games.
//
// Env: RECORDER_SECRET (shared bearer auth), APP_ORIGIN (e.g. https://bandbox.tv),
//      MAX_MINUTES (safety cap, default 240), PORT (Railway sets this).

import express from 'express'
import puppeteer from 'puppeteer'

const PORT = process.env.PORT || 3000
const SECRET = process.env.RECORDER_SECRET || ''
const APP_ORIGIN = (process.env.APP_ORIGIN || 'https://bandbox.tv').replace(/\/$/, '')
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 240)

let browser = null
async function getBrowser() {
  if (browser && browser.connected) return browser
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  return browser
}

const active = new Map() // gameId -> page

async function record(gameId, token) {
  if (active.has(gameId)) {
    console.log('[rec] already recording', gameId)
    return
  }
  const b = await getBrowser()
  const page = await b.newPage()
  active.set(gameId, page)
  const url = `${APP_ORIGIN}/record/${encodeURIComponent(gameId)}?token=${encodeURIComponent(token)}&max=${MAX_MINUTES}`
  console.log('[rec] start', gameId)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const deadline = Date.now() + (MAX_MINUTES + 5) * 60000
    // Poll the page's exposed status; exit when the recording finishes or errors.
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000))
      if (page.isClosed()) break
      const status = await page.evaluate(() => window.__recorder?.status).catch(() => null)
      if (status === 'done' || status === 'error') {
        console.log('[rec] page reported', status, gameId)
        break
      }
    }
  } catch (e) {
    console.error('[rec] error', gameId, e?.message || e)
  } finally {
    try {
      await page.close()
    } catch {
      /* ignore */
    }
    active.delete(gameId)
    console.log('[rec] end', gameId)
  }
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true, active: [...active.keys()] }))

app.post('/record', (req, res) => {
  if (!SECRET || req.headers.authorization !== `Bearer ${SECRET}`) {
    return res.status(403).json({ error: 'forbidden' })
  }
  const { gameId, token } = req.body || {}
  if (!gameId || !token) return res.status(400).json({ error: 'missing gameId/token' })
  record(gameId, token) // fire-and-forget; recording runs in the background
  res.json({ ok: true })
})

app.listen(PORT, () => console.log(`[rec] recorder-manager listening on ${PORT}, origin ${APP_ORIGIN}`))
