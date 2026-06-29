import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { usePhoneVideo } from '@/lib/phoneVideo'
import { gameChannelName } from '@/lib/realtime'
import { HeaderWordmark } from '@/components/Logo'

type Resolved = {
  game_id: string
  video_source: string
  away: { name: string; code: string | null }
  home: { name: string; code: string | null }
}

// Scorer-controlled broadcaster page, reached only via the private link/QR shown
// on the scorer's Video screen. The filming phone opens it and goes live; viewers
// (on the public watch link) can only receive, never broadcast.
export default function Broadcast() {
  const { token } = useParams()
  const [data, setData] = useState<Resolved | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    supabase.rpc('resolve_broadcast', { p_token: token }).then(({ data, error }) => {
      if (error) return setErr(error.message)
      if (!data) return setErr('That broadcast link isn’t valid.')
      setData(data as Resolved)
    })
  }, [token])

  if (err) return <Center>{err}</Center>
  if (!data) return <Center>Loading…</Center>

  const code = (t: { code: string | null; name: string }) => t.code ?? t.name
  return (
    <Broadcaster gameId={data.game_id} token={token!} title={`${code(data.away)} @ ${code(data.home)}`} />
  )
}

function Broadcaster({ gameId, token, title }: { gameId: string; token: string; title: string }) {
  const v = usePhoneVideo(gameId, true)
  const localRef = useRef<HTMLVideoElement>(null)
  const [ended, setEnded] = useState(false)
  const stop = v.stop

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = v.local
  }, [v.local])

  // Record the broadcast — the same 16:9 canvas + audio the viewers see — and upload
  // it when the broadcast stops, so the game can be replayed with the synced scorebug
  // and AI commentary. started_at anchors the video to the event log's wall_clock_ts.
  // (v1: chunks accumulate in memory and upload once on stop; long games will need
  // incremental/chunked upload — see docs/bandbox-plan.md.)
  const recChunks = useRef<Blob[]>([])
  const recStartedAt = useRef(0)
  const recMime = useRef('')

  async function uploadRecording() {
    const chunks = recChunks.current
    recChunks.current = []
    if (!chunks.length) return
    const full = recMime.current || 'video/webm'
    const base = full.split(';')[0] || 'video/webm'
    const startedAt = recStartedAt.current
    const ext = base.includes('mp4') ? 'mp4' : 'webm'
    const path = `recordings/${gameId}/${startedAt}.${ext}`
    const { error } = await supabase.storage
      .from('bpw-video')
      .upload(path, new Blob(chunks, { type: full }), { contentType: base, upsert: true })
    if (error) return
    await supabase.rpc('save_recording', {
      p_token: token,
      p_path: path,
      p_started_at: new Date(startedAt).toISOString(),
      p_duration_ms: Date.now() - startedAt,
      p_mime: base,
    })
  }

  useEffect(() => {
    const stream = v.local
    if (!stream || typeof MediaRecorder === 'undefined') return
    const mime =
      ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
        (m) => {
          try {
            return MediaRecorder.isTypeSupported(m)
          } catch {
            return false
          }
        },
      ) ?? ''
    let rec: MediaRecorder
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch {
      return
    }
    recChunks.current = []
    recMime.current = rec.mimeType || mime || 'video/webm'
    recStartedAt.current = Date.now()
    rec.ondataavailable = (e) => {
      if (e.data?.size) recChunks.current.push(e.data)
    }
    rec.start(4000)
    return () => {
      if (rec.state !== 'inactive') {
        rec.onstop = uploadRecording
        try {
          rec.stop()
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.local])

  // End the broadcast when the scorer ends the game. Catch it instantly off the
  // scorer's state broadcast, and poll as a fallback in case that event is missed.
  useEffect(() => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setEnded(true)
      stop()
    }
    const ch = supabase
      .channel(gameChannelName(gameId))
      .on('broadcast', { event: 'state' }, ({ payload }) => {
        if ((payload as { status?: string })?.status === 'final') finish()
      })
      .subscribe()
    const poll = setInterval(async () => {
      const { data } = await supabase.rpc('get_public_game', { p_game_id: gameId })
      if ((data as { status?: string })?.status === 'final') finish()
    }, 20000)
    return () => {
      clearInterval(poll)
      supabase.removeChannel(ch)
    }
  }, [gameId, stop])

  if (ended)
    return (
      <Center>
        <div className="space-y-2">
          <p className="font-display text-2xl text-gold">Game over</p>
          <p className="font-data text-sm text-muted-green">The broadcast has ended. You can close this screen.</p>
        </div>
      </Center>
    )

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-night-green text-cream">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <HeaderWordmark />
        <span className="font-athletic text-sm uppercase tracking-[.18em] text-muted-green">Broadcast</span>
      </header>

      {v.isBroadcasting ? (
        <div className="relative min-h-0 flex-1 bg-black">
          <video ref={localRef} autoPlay playsInline muted className="h-full w-full object-contain" />

          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-black/50 px-4 py-2">
            <span className="flex items-center gap-2 font-athletic text-sm font-semibold uppercase tracking-wide">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-barn-red" />
              Live · {v.viewers} watching
            </span>
            <button onClick={v.stop} className="bg-barn-red px-4 py-1.5 font-display text-cream">
              Stop
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-black/50 px-4 py-3">
            {v.zoomRange && (
              <label className="flex items-center gap-3 font-athletic text-xs uppercase tracking-wide">
                <span>Zoom</span>
                <input
                  type="range"
                  min={v.zoomRange.min}
                  max={v.zoomRange.max}
                  step={v.zoomRange.step}
                  value={v.zoom}
                  onChange={(e) => v.setZoom(Number(e.target.value))}
                  className="flex-1 accent-board-green"
                />
              </label>
            )}
            {v.cameras.length > 1 && (
              <label className="flex items-center gap-3 font-athletic text-xs uppercase tracking-wide">
                <span>Camera</span>
                <select
                  value={v.cameraId ?? ''}
                  onChange={(e) => v.selectCamera(e.target.value)}
                  className="flex-1 border-2 border-cream/40 bg-black/40 px-2 py-1.5 font-data text-sm text-cream"
                >
                  {v.cameras.map((c) => (
                    <option key={c.deviceId} value={c.deviceId} className="text-ink">
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="font-display text-2xl">{title}</p>
          <p className="max-w-xs font-data text-sm text-muted-green">
            This phone will film the game. Family watching the share link will see your video with
            the live scorebug.
          </p>
          <button
            onClick={v.goLive}
            className="bg-board-green px-8 py-4 font-display text-xl text-cream"
          >
            Start broadcast ▸
          </button>
          {v.error && <p className="font-data text-sm text-barn-red">{v.error}</p>}
        </div>
      )}
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-night-green p-6 text-center font-data text-cream">
      {children}
    </div>
  )
}
