import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { whepPlay, type RtcSession } from '@/lib/whip'
import { createStreamUploader } from '@/lib/streamUpload'

// Server-side (headless) recorder for the PAID full-quality replay. A headless Chrome
// opens /record/:gameId?token=<broadcast grant>; this joins the live WHEP feed and records
// the full-quality stream. The phone is untouched (still WHIPs live).
//
// TWO KEY BEHAVIORS:
//  1. Recording does NOT start until the GAME goes live (status 'live' / game_start) — so
//     the replay never contains pre-game camera footage.
//  2. RECONNECT-PROOF: the feed is drawn onto a stable canvas and its audio routed through
//     a stable Web-Audio sink, so ONE continuous MediaRecorder survives broadcaster blips;
//     WHEP reconnects under it. It finishes only when the game goes final (or media is gone
//     for a long stretch, or a safety cap).
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
    ;(window as unknown as { __recorder?: Record<string, unknown> }).__recorder = { status, bytes, gameId }
  }, [status, bytes, gameId])

  useEffect(() => {
    if (!gameId || !token) {
      setStatus('error')
      setDetail('missing gameId or token')
      return
    }
    let cancelled = false
    let done = false
    let started = false
    let session: RtcSession | null = null
    let recorder: MediaRecorder | null = null
    let uploader: ReturnType<typeof createStreamUploader> | null = null
    let audioCtx: AudioContext | null = null
    let audioDest: MediaStreamAudioDestinationNode | null = null
    let audioSrc: MediaStreamAudioSourceNode | null = null
    let currentStream: MediaStream | null = null
    let raf = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let silentTimer: ReturnType<typeof setTimeout> | undefined
    let maxTimer: ReturnType<typeof setTimeout> | undefined
    let statusPoll: ReturnType<typeof setInterval> | undefined
    let gapPoll: ReturnType<typeof setInterval> | undefined
    let lastMediaAt = Date.now()

    // Stable capture surfaces (never torn down until finish → one continuous recording).
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.autoplay = true
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')

    const draw = () => {
      if (ctx && video.videoWidth) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        lastMediaAt = Date.now()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()

    const routeAudio = () => {
      if (!audioCtx || !audioDest || !currentStream) return
      try {
        audioSrc?.disconnect()
      } catch {
        /* ignore */
      }
      const at = currentStream.getAudioTracks()
      if (at.length) {
        audioSrc = audioCtx.createMediaStreamSource(new MediaStream([at[0]]))
        audioSrc.connect(audioDest)
      }
    }

    const finish = async () => {
      if (done) return
      done = true
      clearTimeout(reconnectTimer)
      clearTimeout(silentTimer)
      clearTimeout(maxTimer)
      clearInterval(statusPoll)
      clearInterval(gapPoll)
      cancelAnimationFrame(raf)
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
        session?.close()
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

    // Start the ONE continuous recorder — called only once the game is live AND media is
    // flowing, so pre-game footage is never captured.
    const startRecorder = () => {
      if (started || cancelled || done) return
      started = true
      audioCtx = new AudioContext()
      audioDest = audioCtx.createMediaStreamDestination()
      routeAudio()
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
      uploader = createStreamUploader({ gameId, token, startedAt: Date.now(), mime: mime || 'video/webm' })
      recorder = mime
        ? new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 128_000 })
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
      // Wrap up if the feed's been gone a long time (broadcast ended without a final).
      gapPoll = setInterval(() => {
        if (Date.now() - lastMediaAt > 120_000) void finish()
      }, 15_000)
    }

    const wireStream = (stream: MediaStream) => {
      currentStream = stream
      video.srcObject = stream
      video.play().catch(() => {})
      lastMediaAt = Date.now()
      routeAudio() // no-op until the recorder (and its audio graph) has started
    }

    ;(async () => {
      const { data } = await supabase.rpc('get_public_game', { p_game_id: gameId })
      const whep = (data as { cf_whep_url?: string | null } | null)?.cf_whep_url
      if (cancelled) return
      if (!whep) {
        setStatus('error')
        setDetail('no live stream for this game')
        return
      }
      setStatus('connecting')
      const startupDeadline = Date.now() + 120_000

      // Poll the game status: START recording when it goes live (never before → no pregame),
      // FINISH when it goes final.
      statusPoll = setInterval(async () => {
        if (done) return
        const { data: g } = await supabase.rpc('get_public_game', { p_game_id: gameId })
        const s = (g as { status?: string } | null)?.status
        if (s === 'final') return void finish()
        if (s === 'live' && !started && video.videoWidth) {
          startRecorder()
        } else if (s === 'live' && !started) {
          setStatus('connecting') // live but no media yet
        } else if (!started) {
          setStatus('waiting-for-start')
        }
      }, 2000)

      const connect = async () => {
        if (cancelled || done) return
        let attempt: RtcSession | null = null
        const drop = () => {
          try {
            attempt?.close()
          } catch {
            /* ignore */
          }
          if (done || cancelled) return
          if (!started && Date.now() > startupDeadline) return // give the status poll the last word
          clearTimeout(reconnectTimer)
          reconnectTimer = setTimeout(connect, 2000) // survive blips: reconnect under the recorder
        }
        clearTimeout(silentTimer)
        silentTimer = setTimeout(() => {
          if (!video.videoWidth) drop()
        }, 8000)
        try {
          attempt = await whepPlay(
            whep,
            (stream) => {
              clearTimeout(silentTimer)
              session = attempt
              wireStream(stream)
            },
            (state) => {
              if (state === 'failed' || state === 'disconnected') {
                clearTimeout(silentTimer)
                drop()
              }
            },
          )
          if (cancelled) attempt.close()
        } catch {
          clearTimeout(silentTimer)
          drop()
        }
      }
      void connect()
    })()

    return () => {
      cancelled = true
      done = true
      clearTimeout(reconnectTimer)
      clearTimeout(silentTimer)
      clearTimeout(maxTimer)
      clearInterval(statusPoll)
      clearInterval(gapPoll)
      cancelAnimationFrame(raf)
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      session?.close()
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
