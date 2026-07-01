import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [saveErr, setSaveErr] = useState<string>('')
  const [progress, setProgress] = useState('')
  const [recBytes, setRecBytes] = useState(0) // live diagnostic: is the recorder capturing?
  const vstop = v.stop

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
  const recRef = useRef<MediaRecorder | null>(null)
  const uploadedRef = useRef(false)

  // Upload one part to a signed URL, with a few retries (mobile networks blip).
  async function uploadPart(path: string, body: Blob, contentType: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: sign, error: signErr } = await supabase.functions.invoke('sign-upload', {
        body: { token, path },
      })
      if (!signErr && sign?.token) {
        const { error } = await supabase.storage
          .from('bpw-video')
          .uploadToSignedUrl(path, sign.token, body, { contentType })
        if (!error) return true
      }
    }
    return false
  }

  async function uploadRecording() {
    if (uploadedRef.current) return // fire once, however the recorder stopped
    const chunks = recChunks.current
    recChunks.current = []
    if (!chunks.length) return
    uploadedRef.current = true
    setSaveState('saving')
    const full = recMime.current || 'video/webm'
    const base = full.split(';')[0] || 'video/webm'
    const startedAt = recStartedAt.current
    const ext = base.includes('mp4') ? 'mp4' : 'webm'
    // Record is ONE file; upload it in small byte-slices so a dropped part retries
    // instead of losing the whole game. The viewer concatenates the parts back into
    // the original file (they're contiguous slices), so the replay is still one video.
    const blob = new Blob(chunks, { type: full })
    const PART = 5 * 1024 * 1024
    const nParts = Math.max(1, Math.ceil(blob.size / PART))
    const dir = `recordings/${gameId}/${startedAt}`
    const paths: string[] = []
    for (let i = 0; i < nParts; i++) {
      setProgress(`part ${i + 1} of ${nParts}`)
      const slice = blob.slice(i * PART, Math.min((i + 1) * PART, blob.size), base)
      const path = `${dir}/p-${String(i).padStart(4, '0')}.${ext}`
      if (!(await uploadPart(path, slice, base))) {
        setSaveErr(`upload failed at part ${i + 1}/${nParts}`)
        return setSaveState('failed')
      }
      paths.push(path)
    }
    const { error: recErr } = await supabase.rpc('save_recording', {
      p_token: token,
      p_path: paths[0] ?? null,
      p_started_at: new Date(startedAt).toISOString(),
      p_duration_ms: Date.now() - startedAt,
      p_mime: base,
      p_segments: paths,
    })
    if (recErr) setSaveErr(`save: ${recErr.message}`)
    setSaveState(recErr ? 'failed' : 'saved')
  }

  useEffect(() => {
    if (!v.local || typeof MediaRecorder === 'undefined') return // v.local set = we're broadcasting
    // Record the RAW CAMERA stream, NOT the 16:9 canvas — iOS Safari's MediaRecorder
    // can't record a canvas.captureStream() (it produces no data). We crop the camera
    // recording to 16:9 on playback to match the live framing.
    const stream = v.getCameraStream() ?? v.local
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
    // Cap the bitrate — iOS records at a very high default, which blows past upload
    // size limits even for short clips. ~2 Mbps is plenty for a 720p replay.
    const recOpts: MediaRecorderOptions = { videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96_000 }
    let rec: MediaRecorder
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, ...recOpts }) : new MediaRecorder(stream, recOpts)
    } catch {
      try {
        rec = new MediaRecorder(stream)
      } catch {
        return
      }
    }
    recChunks.current = []
    recMime.current = rec.mimeType || mime || 'video/webm'
    recStartedAt.current = Date.now()
    recRef.current = rec
    rec.ondataavailable = (e) => {
      if (e.data?.size) {
        recChunks.current.push(e.data)
        setRecBytes((b) => b + e.data.size)
      }
    }
    // Upload whenever the recorder stops — explicit stop, OR auto-stop when the stream's
    // tracks end on teardown. (The old code only uploaded from the cleanup, which the
    // auto-stop pre-empted, so nothing ever uploaded.)
    rec.onstop = () => {
      void uploadRecording()
    }
    rec.start(4000)
    return () => {
      try {
        if (rec.state !== 'inactive') rec.stop()
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.local])

  // End everything cleanly: flush + stop the recorder (while the stream is still
  // alive) BEFORE tearing the stream down, so the recording is captured and uploaded.
  const endBroadcast = useCallback(() => {
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
    } catch {
      /* ignore */
    }
    vstop()
  }, [vstop])

  // End the broadcast when the scorer ends the game. Catch it instantly off the
  // scorer's state broadcast, and poll as a fallback in case that event is missed.
  useEffect(() => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setEnded(true)
      endBroadcast()
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
  }, [gameId, endBroadcast])

  if (ended)
    return (
      <Center>
        <div className="space-y-2">
          <p className="font-display text-2xl text-gold">Game over</p>
          {saveState === 'saving' && (
            <p className="font-data text-sm text-gold">
              Saving the replay{progress ? ` (${progress})` : ''}… keep this screen open.
            </p>
          )}
          {saveState === 'saved' && (
            <p className="font-data text-sm text-board-green">Replay saved ✓ You can close this screen.</p>
          )}
          {saveState === 'failed' && (
            <>
              <p className="font-data text-sm text-barn-red">Couldn’t save the replay (the game stats are safe).</p>
              {saveErr && <p className="font-data text-[11px] text-muted-green">{saveErr}</p>}
            </>
          )}
          {saveState === 'idle' && recBytes === 0 && (
            <p className="font-data text-[11px] text-muted-green">
              (No video was captured on this device — recording isn’t supported by this browser.)
            </p>
          )}
          {saveState === 'idle' && (
            <p className="font-data text-sm text-muted-green">The broadcast has ended. You can close this screen.</p>
          )}
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
              Live · {v.viewers} watching ·{' '}
              <span className={recBytes > 0 ? 'text-board-green' : 'text-gold'}>
                REC {(recBytes / 1e6).toFixed(1)}MB
              </span>
            </span>
            <button onClick={endBroadcast} className="bg-barn-red px-4 py-1.5 font-display text-cream">
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
                  className="flex-1 appearance-none rounded-none border-2 border-cream/40 bg-black/40 px-2 py-1.5 font-data text-sm text-cream"
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
