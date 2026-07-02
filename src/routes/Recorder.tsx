import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { whepPlay, type RtcSession } from '@/lib/whip'
import { createStreamUploader } from '@/lib/streamUpload'

// Server-side (headless) recorder for the PAID full-quality replay. A headless Chrome
// opens /record/:gameId?token=<broadcast grant>; this joins the live WHEP feed and records
// the full-quality stream via MediaRecorder → the streaming uploader → the game's replay.
// The phone is untouched (still WHIPs full-quality live). Ends when the live stream stops.
//
// Status is mirrored to document.title + window.__recorder so the orchestrator can poll
// the headless page and tear the machine down when it reads "done".
type Status = 'starting' | 'waiting' | 'recording' | 'saving' | 'done' | 'error'

export default function Recorder() {
  const { gameId } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token')
  const maxMinutes = Number(params.get('max') ?? 240) // safety cap
  const [status, setStatus] = useState<Status>('starting')
  const [detail, setDetail] = useState('')
  const [bytes, setBytes] = useState(0)
  const doneRef = useRef(false)

  useEffect(() => {
    // Expose status for the headless orchestrator.
    document.title = `rec:${status}`
    ;(window as unknown as { __recorder?: Record<string, unknown> }).__recorder = { status, bytes, gameId }
  }, [status, bytes, gameId])

  useEffect(() => {
    if (!gameId || !token) {
      setStatus('error')
      setDetail('missing gameId or token')
      return
    }
    let session: RtcSession | null = null
    let recorder: MediaRecorder | null = null
    let uploader: ReturnType<typeof createStreamUploader> | null = null
    let started = false
    let endTimer: ReturnType<typeof setTimeout> | undefined
    let maxTimer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    const finish = async () => {
      if (doneRef.current) return
      doneRef.current = true
      clearTimeout(endTimer)
      clearTimeout(maxTimer)
      setStatus('saving')
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      // give the final ondataavailable a tick to land
      await new Promise((r) => setTimeout(r, 500))
      try {
        session?.close()
      } catch {
        /* ignore */
      }
      const ok = uploader ? await uploader.finalize() : false
      setStatus(ok ? 'done' : 'error')
      if (!ok) setDetail('save failed')
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
      setStatus('waiting')

      try {
        session = await whepPlay(
          whep,
          (stream) => {
            if (cancelled || started) return
            started = true
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
              ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 128_000 })
              : new MediaRecorder(stream)
            recorder.ondataavailable = (e) => {
              if (e.data?.size && uploader) {
                uploader.add(e.data)
                setBytes(uploader.bytes())
              }
            }
            recorder.start(4000)
            setStatus('recording')
            // Safety cap so a forgotten stream can't record forever.
            maxTimer = setTimeout(() => void finish(), maxMinutes * 60_000)
          },
          (state) => {
            if (cancelled) return
            if (state === 'failed' || state === 'disconnected') {
              // Live stream ended (or dropped). Wait a short grace for a resume; if none,
              // finalize. (A brief blip that resumes on the SAME session keeps recording.)
              if (started) {
                clearTimeout(endTimer)
                endTimer = setTimeout(() => void finish(), 12_000)
              }
            }
          },
        )
      } catch {
        if (!cancelled) {
          setStatus('error')
          setDetail('could not join the live feed')
        }
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(endTimer)
      clearTimeout(maxTimer)
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      session?.close()
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
