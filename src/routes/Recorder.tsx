import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import { supabase } from '@/lib/supabase'
import { createStreamUploader } from '@/lib/streamUpload'

// Server-side (headless) recorder for the PAID full-quality replay. A headless Chrome opens
// /record/:gameId?token=<broadcast grant>; it pulls the live HLS feed and records it. The
// phone is untouched (still WHIPs live).
//
// Why HLS, not WHEP: the recorder used to subscribe via WHEP (WebRTC), but that session went
// "connected but silent" on Railway's network and froze recordings to a few seconds — even
// while the broadcast/live viewers were perfect. HLS is a continuous CDN pull (plain segment
// fetches, no WebRTC session to go silent), so the capture is reliable end-to-end.
//
// KEY BEHAVIORS:
//  1. Recording starts only once the GAME goes live (never before → no pre-game footage).
//  2. Sync anchor = the HLS content clock (PROGRAM-DATE-TIME via hls.playingDate) so the
//     replay's scorebug/commentary line up with the delayed video; falls back to now().
//  3. Finishes when the feed ends (HLS playhead stalls) or the game goes final, plus a cap.
//
// Status is mirrored to window.__recorder / document.title so the manager can poll it.
type Status = 'starting' | 'connecting' | 'waiting-for-start' | 'recording' | 'saving' | 'done' | 'error'

export default function Recorder() {
  const { gameId } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token')
  const maxMinutes = Number(params.get('max') ?? 240)
  const [status, setStatus] = useState<Status>('starting')
  const [detail, setDetail] = useState('')
  const [bytes, setBytes] = useState(0)

  useEffect(() => {
    document.title = `rec:${status}`
    ;(window as unknown as { __recorder?: Record<string, unknown> }).__recorder = { status, bytes, detail, gameId }
  }, [status, bytes, detail, gameId])

  useEffect(() => {
    if (!gameId || !token) {
      setStatus('error')
      setDetail('missing gameId or token')
      return
    }
    let cancelled = false
    let done = false
    let started = false
    let recorder: MediaRecorder | null = null
    let uploader: ReturnType<typeof createStreamUploader> | null = null
    let audioCtx: AudioContext | null = null
    let hls: Hls | null = null
    let mediaReceived = false
    let drawTimer: ReturnType<typeof setInterval> | undefined
    let maxTimer: ReturnType<typeof setTimeout> | undefined
    let finalTimer: ReturnType<typeof setTimeout> | undefined
    let statusPoll: ReturnType<typeof setInterval> | undefined
    let gapPoll: ReturnType<typeof setInterval> | undefined
    let lastMediaAt = Date.now()
    let lastVideoTime = -1

    // Stable capture surface (never torn down until finish → one continuous recording).
    const video = document.createElement('video')
    video.playsInline = true
    video.autoplay = true
    video.crossOrigin = 'anonymous'
    // NOT muted: the recorder-manager launches Chrome with
    // --autoplay-policy=no-user-gesture-required, so unmuted autoplay works, and we need the
    // element's audio to decode so createMediaElementSource can capture it into the recording.
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')

    // Drive the canvas on a timer, NOT requestAnimationFrame — headless Chrome throttles rAF
    // on the offscreen page. lastMediaAt advances only when the playhead actually moves, so a
    // stalled feed (broadcast ended) is detectable.
    const draw = () => {
      if (ctx && video.videoWidth) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        if (video.currentTime !== lastVideoTime) {
          lastMediaAt = Date.now()
          lastVideoTime = video.currentTime
          mediaReceived = true
        }
      }
    }
    drawTimer = setInterval(draw, 33) // ~30fps

    const finish = async () => {
      if (done) return
      done = true
      clearTimeout(maxTimer)
      clearTimeout(finalTimer)
      clearInterval(statusPoll)
      clearInterval(gapPoll)
      clearInterval(drawTimer)
      if (!started) {
        setStatus('error')
        setDetail('game never went live')
        return
      }
      setStatus('saving')
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500)) // let the final chunk land
      try {
        hls?.destroy()
      } catch {
        /* ignore */
      }
      try {
        await audioCtx?.close()
      } catch {
        /* ignore */
      }
      const ok = uploader ? await uploader.finalize() : false
      setStatus(ok ? 'done' : 'error')
      if (!ok) setDetail('save failed')
    }

    // Start the ONE continuous recorder — only once the game is live AND media is flowing.
    const startRecorder = () => {
      if (started || cancelled || done) return
      started = true
      audioCtx = new AudioContext()
      void audioCtx.resume().catch(() => {})
      const audioDest = audioCtx.createMediaStreamDestination()
      try {
        // Tap the video element's decoded audio into the recording graph.
        audioCtx.createMediaElementSource(video).connect(audioDest)
      } catch {
        /* no audio track — record video only */
      }
      const videoTrack = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream })
        .captureStream(30)
        .getVideoTracks()[0]
      const mixed = new MediaStream([videoTrack, ...audioDest.stream.getAudioTracks()])
      const mime =
        ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => {
          try {
            return MediaRecorder.isTypeSupported(m)
          } catch {
            return false
          }
        }) ?? ''
      // Anchor to the HLS content wall-clock so the replay lines up with the delayed video.
      const anchor = hls?.playingDate?.getTime() ?? Date.now()
      uploader = createStreamUploader({ gameId, token, startedAt: anchor, mime: mime || 'video/webm' })
      recorder = mime
        ? new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 128_000 })
        : new MediaRecorder(mixed)
      recorder.ondataavailable = (e) => {
        if (e.data?.size && uploader) {
          uploader.add(e.data)
          setBytes(uploader.bytes())
        }
      }
      recorder.start(4000)
      setStatus('recording')
      maxTimer = setTimeout(() => void finish(), maxMinutes * 60_000)
      // The broadcast ended if the HLS playhead stops advancing for a sustained stretch
      // (no new segments) — that's the reliable "we're done" signal for a pull-based feed.
      gapPoll = setInterval(() => {
        if (Date.now() - lastMediaAt > 25_000) void finish()
      }, 5_000)
    }

    ;(async () => {
      const { data } = await supabase.rpc('get_public_game', { p_game_id: gameId })
      const hlsUrl = (data as { cf_hls_url?: string | null } | null)?.cf_hls_url
      if (cancelled) return
      if (!hlsUrl) {
        setStatus('error')
        setDetail('no live stream for this game')
        return
      }
      setStatus('connecting')

      // Pull the live HLS. lowLatencyMode keeps us close to live (less delay to sync-correct);
      // it's the LIVE feed so low-latency is correct here (unlike VOD replay).
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 })
        hls.loadSource(hlsUrl)
        hls.attachMedia(video)
      } else {
        video.src = hlsUrl // native HLS (Safari) — unlikely in the headless recorder
      }
      video.play().catch(() => {})

      // Poll the game status: START recording when it goes live (never before → no pregame);
      // on FINAL, drain the delayed tail then wrap up (the stall watchdog usually gets there
      // first once the broadcaster's WHIP stops and HLS stops advancing).
      statusPoll = setInterval(async () => {
        if (done) return
        const { data: g } = await supabase.rpc('get_public_game', { p_game_id: gameId })
        const s = (g as { status?: string } | null)?.status
        if (s === 'final') {
          if (started && !finalTimer) finalTimer = setTimeout(() => void finish(), 30_000)
          else if (!started) return void finish()
          return
        }
        if (s === 'live' && !started && mediaReceived) startRecorder()
        else if (s === 'live' && !started) setStatus('connecting')
        else if (!started) setStatus('waiting-for-start')
      }, 2000)
    })()

    return () => {
      cancelled = true
      done = true
      clearTimeout(maxTimer)
      clearTimeout(finalTimer)
      clearInterval(statusPoll)
      clearInterval(gapPoll)
      clearInterval(drawTimer)
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      try {
        hls?.destroy()
      } catch {
        /* ignore */
      }
      audioCtx?.close().catch(() => {})
    }
  }, [gameId, token, maxMinutes])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-ink p-6 text-center font-data text-cream">
      <p className="font-display text-xl text-gold">Bandbox recorder</p>
      <p className="text-sm uppercase tracking-wide">
        {status}
        {detail ? ` — ${detail}` : ''}
      </p>
      <p className="text-xs text-muted-green">{(bytes / 1e6).toFixed(1)} MB captured</p>
    </div>
  )
}
