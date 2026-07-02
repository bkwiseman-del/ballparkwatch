import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { usePhoneVideo } from '@/lib/phoneVideo'
import { startCanvasRecording, webCodecsSupported, type CanvasRecorder } from '@/lib/canvasRecorder'
import { whipPublish, type RtcSession } from '@/lib/whip'
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
  const recStartedAt = useRef(0)
  const recMime = useRef('')
  const recRef = useRef<MediaRecorder | null>(null)
  const webRecRef = useRef<CanvasRecorder | null>(null)
  const uploadedRef = useRef(false)
  const whipRef = useRef<RtcSession | null>(null)
  const [streamState, setStreamState] = useState<'off' | 'connecting' | 'live' | 'error'>('off')
  const [streamErr, setStreamErr] = useState<string>('') // shown on-screen (phones have no console)

  // --- streaming part uploader ---
  // The recorder emits append-only chunks DURING the game (fragmented mp4 / MediaRecorder
  // timeslices). We buffer to ~PART-sized parts, upload each as it fills, then free it —
  // so the whole game is never held in memory (safe on long games). A dropped part still
  // retries; the viewer concatenates the parts back into one file.
  const PART_SIZE = 4 * 1024 * 1024
  const upBuf = useRef<BlobPart[]>([])
  const upLen = useRef(0)
  const upIndex = useRef(0)
  const upPaths = useRef<string[]>([])
  const upChain = useRef<Promise<void>>(Promise.resolve())
  const upFailed = useRef(false)

  function resetUploader() {
    upBuf.current = []
    upLen.current = 0
    upIndex.current = 0
    upPaths.current = []
    upChain.current = Promise.resolve()
    upFailed.current = false
    uploadedRef.current = false
  }
  function partMime() {
    const base = (recMime.current || 'video/mp4').split(';')[0]
    return { base, ext: base.includes('mp4') ? 'mp4' : 'webm' }
  }

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

  // Queue a serialized upload of the current buffer as the next part, then free it.
  function flushPart() {
    if (upLen.current === 0) return
    const { base, ext } = partMime()
    const blob = new Blob(upBuf.current, { type: base })
    const idx = upIndex.current++
    upBuf.current = []
    upLen.current = 0
    const path = `recordings/${gameId}/${recStartedAt.current}/p-${String(idx).padStart(4, '0')}.${ext}`
    upPaths.current.push(path)
    upChain.current = upChain.current.then(async () => {
      if (upFailed.current) return
      setProgress(`part ${idx + 1}`)
      if (!(await uploadPart(path, blob, base))) upFailed.current = true
    })
  }

  // Feed one recorder chunk in during the game; flush a part when the buffer fills.
  function pushRecData(data: Blob | Uint8Array) {
    const size = data instanceof Blob ? data.size : data.byteLength
    if (!size) return
    upBuf.current.push(data as BlobPart)
    upLen.current += size
    setRecBytes((b) => b + size)
    if (upLen.current >= PART_SIZE) flushPart()
  }

  // On stop: flush the remainder, wait for all uploads, save the metadata.
  async function finalizeUpload() {
    if (uploadedRef.current) return // fire once
    uploadedRef.current = true
    if (upIndex.current === 0 && upLen.current === 0) return // nothing captured
    setSaveState('saving')
    flushPart()
    await upChain.current
    if (upFailed.current) {
      setSaveErr('upload failed')
      return setSaveState('failed')
    }
    const { base } = partMime()
    const { error: recErr } = await supabase.rpc('save_recording', {
      p_token: token,
      p_path: upPaths.current[0] ?? null,
      p_started_at: new Date(recStartedAt.current).toISOString(),
      p_duration_ms: Date.now() - recStartedAt.current,
      p_mime: base,
      p_segments: upPaths.current,
    })
    if (recErr) setSaveErr(`save: ${recErr.message}`)
    setSaveState(recErr ? 'failed' : 'saved')
  }

  useEffect(() => {
    // Cloudflare WHIP does NOT record server-side (confirmed — see the build plan), so
    // local device recording IS the replay. It's a SECOND encode alongside the WHIP live
    // encode, so we keep it light: hardware-accelerated H.264, downscaled to ~480p/24fps
    // (see canvasRecorder). If WHIP recording ever ships, delete this and it's free.
    if (!v.local) return
    resetUploader()
    recStartedAt.current = Date.now()
    setRecBytes(0)

    // PRIMARY: WebCodecs. Encode the upright canvas ourselves (VideoEncoder + our own
    // mux), so the recording is upright by construction (we own the pixels — no iOS
    // orientation metadata to get wrong), matches the live framing exactly, and is
    // size-bounded by a real bitrate cap. This is the durable fix for the rotation +
    // file-size bugs. MediaRecorder below is only a fallback for browsers without it.
    const canvas = v.getCanvas()
    if (canvas && webCodecsSupported()) {
      let cancelled = false
      const audioTrack = v.local.getAudioTracks()[0] ?? v.getCameraStream()?.getAudioTracks()[0] ?? null
      recMime.current = 'video/mp4'
      // 480p/24fps encode, streamed out fragment-by-fragment to the incremental uploader
      // (nothing large kept in memory) — a light second pass next to the WHIP live encode.
      startCanvasRecording({ canvas, audioTrack, targetHeight: 480, fps: 24, onChunk: (d) => pushRecData(d) })
        .then((r) => {
          if (!r) {
            startMediaRecorder() // encoder unsupported for this frame — fall back
            return
          }
          if (cancelled) {
            void r.stop()
            return
          }
          webRecRef.current = r
        })
        .catch(() => startMediaRecorder())
      return () => {
        cancelled = true
        // Best-effort on unmount; the primary end path awaits this via endBroadcast.
        void finishRecording()
      }
    }

    // FALLBACK: MediaRecorder (canvas stream, with a watchdog to the raw camera).
    return startMediaRecorder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.local])

  // MediaRecorder fallback path, factored out so the WebCodecs branch can defer to it.
  // Returns a cleanup fn (matches the useEffect contract).
  function startMediaRecorder(): () => void {
    if (!v.local || typeof MediaRecorder === 'undefined') return () => {}
    const canvasStream = v.local
    const rawStream = v.getCameraStream()
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
    // Cap the bitrate — a raw recording defaults very high, which blows past upload
    // size limits even for short clips. ~1.2 Mbps is plenty for a 720p phone replay.
    const recOpts: MediaRecorderOptions = { videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 96_000 }

    const makeRecorder = (stream: MediaStream): MediaRecorder | null => {
      try {
        return mime ? new MediaRecorder(stream, { mimeType: mime, ...recOpts }) : new MediaRecorder(stream, recOpts)
      } catch {
        try {
          return new MediaRecorder(stream)
        } catch {
          return null
        }
      }
    }

    let fellBack = false
    let watchdog = 0
    let gotData = false

    // Wire a recorder's chunk + stop handlers and start it. Timeslice chunks stream
    // straight into the incremental uploader. `isPrimary` recorders stopped only to
    // trigger the fallback must NOT finalize (the fallback will).
    const wire = (rec: MediaRecorder, isPrimary: boolean) => {
      recMime.current = rec.mimeType || mime || 'video/webm'
      recRef.current = rec
      rec.ondataavailable = (e) => {
        if (e.data?.size) {
          gotData = true
          pushRecData(e.data)
        }
      }
      rec.onstop = () => {
        if (isPrimary && fellBack) return
        void finalizeUpload()
      }
      rec.start(4000)
    }

    resetUploader()
    recStartedAt.current = Date.now()

    const primary = makeRecorder(canvasStream)
    if (primary) {
      wire(primary, true)
      // Watchdog: some older iOS Safari builds emit ZERO bytes when recording a
      // canvas.captureStream(). If nothing has arrived a few seconds in, fall back to
      // the raw camera so the family still gets a replay (accepting the orientation
      // quirk) rather than an empty file. Modern iOS records the canvas fine, so this
      // almost never fires.
      watchdog = window.setTimeout(() => {
        if (gotData || !rawStream) return
        fellBack = true
        try {
          if (primary.state !== 'inactive') primary.stop()
        } catch {
          /* ignore */
        }
        resetUploader()
        setRecBytes(0)
        recStartedAt.current = Date.now()
        gotData = false
        const fb = makeRecorder(rawStream)
        if (fb) wire(fb, false)
      }, 6000)
    } else if (rawStream) {
      // Couldn't even construct a canvas recorder — go straight to the raw camera.
      const fb = makeRecorder(rawStream)
      if (fb) wire(fb, false)
    }

    return () => {
      window.clearTimeout(watchdog)
      const rec = recRef.current
      try {
        if (rec && rec.state !== 'inactive') rec.stop()
      } catch {
        /* ignore */
      }
    }
  }

  // Stop whichever recorder is running and finalize the upload. Idempotent (safe from
  // both endBroadcast and effect cleanup). For WebCodecs we must await the encoder flush
  // (which streams the final fragment into the uploader) BEFORE the tracks are torn down.
  const finishRecording = useCallback(async () => {
    const web = webRecRef.current
    if (web) {
      webRecRef.current = null
      await web.stop() // flushes remaining fragments via onChunk → pushRecData
      await finalizeUpload()
      return
    }
    const rec = recRef.current
    try {
      if (rec && rec.state !== 'inactive') rec.stop() // MediaRecorder finalizes via onstop
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Publish the SAME upright 16:9 canvas (v.local) to Cloudflare Stream via WHIP once
  // we're broadcasting. Stream fans it out to viewers (WHEP, sub-second) and records it
  // server-side. The local recording (above) stays on as the drop-proof backup.
  useEffect(() => {
    if (!v.local) return
    let cancelled = false
    setStreamState('connecting')
    ;(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('stream-live', {
          body: { token, action: 'start' },
        })
        if (cancelled) return
        if (error || !data?.whipUrl) {
          console.error('[stream] live-input error:', error, data)
          setStreamErr(`live-input: ${error?.message ?? data?.error ?? 'unknown'}`)
          setStreamState('error')
          return
        }
        console.info('[stream] publishing via WHIP', data.whipUrl)
        setStreamErr('')
        const session = await whipPublish(data.whipUrl, v.local!, (s) => {
          console.info('[stream] WHIP connection state:', s)
          if (s === 'failed') setStreamErr('WHIP connection failed (ICE)')
          if (s === 'connected') {
            // Anchor the recording clock for replay sync (video t=0 = ingest start).
            void supabase.rpc('stream_mark_started', { p_token: token })
          }
          setStreamState(s === 'connected' ? 'live' : s === 'failed' ? 'error' : 'connecting')
        })
        if (cancelled) {
          session.close()
          return
        }
        whipRef.current = session
      } catch (e) {
        console.error('[stream] WHIP publish failed:', e)
        if (!cancelled) {
          setStreamErr(e instanceof Error ? e.message : 'WHIP publish failed')
          setStreamState('error')
        }
      }
    })()
    return () => {
      cancelled = true
      whipRef.current?.close()
      whipRef.current = null
      setStreamState('off')
    }
  }, [v.local, token])

  // After the game, ask Cloudflare for the auto-recording's VOD id (ready ~60s after the
  // stream ends) and store it as the replay. Poll a few times, best-effort.
  const finalizeStream = useCallback(async () => {
    for (let i = 0; i < 8; i++) {
      try {
        const { data } = await supabase.functions.invoke('stream-live', { body: { token, action: 'finalize' } })
        if (data?.ready) return
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 15000))
    }
  }, [token])

  // End everything cleanly: flush + stop the recorder (while the stream is still
  // alive) BEFORE tearing the stream down, so the recording is captured and uploaded.
  const endBroadcast = useCallback(async () => {
    whipRef.current?.close()
    whipRef.current = null
    await finishRecording()
    vstop()
    void finalizeStream() // grab the Stream recording in the background
  }, [vstop, finishRecording, finalizeStream])

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
              Live ·{' '}
              <span
                className={
                  streamState === 'live'
                    ? 'text-board-green'
                    : streamState === 'error'
                      ? 'text-barn-red'
                      : 'text-gold'
                }
              >
                {streamState === 'live'
                  ? 'streaming'
                  : streamState === 'error'
                    ? 'stream offline'
                    : 'connecting…'}
              </span>{' '}
              ·{' '}
              <span className={recBytes > 0 ? 'text-board-green' : 'text-gold'}>
                REC {(recBytes / 1e6).toFixed(1)}MB
              </span>
            </span>
            <button onClick={endBroadcast} className="bg-barn-red px-4 py-1.5 font-display text-cream">
              Stop
            </button>
          </div>
          {streamState === 'error' && streamErr && (
            <div className="absolute inset-x-0 top-10 bg-barn-red/80 px-4 py-1 text-center font-data text-[11px] text-cream">
              Stream: {streamErr}
            </div>
          )}

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
