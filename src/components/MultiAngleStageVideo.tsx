import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Stage,
  SubscribeType,
  StageEvents,
  type StageParticipantInfo,
  type StageStream,
} from 'amazon-ivs-web-broadcast'
import { supabase } from '@/lib/supabase'
import { ScorebugBar } from '@/components/Scorebug'
import { ScorePanel } from '@/components/ScorePanel'
import type { ScoreboardState } from '@/lib/scoreboard'

type Angle = { pid: string; userId: string; stream: MediaStream }

// Viewer-side multi-angle. Join the game's IVS stage ONCE (subscribe-only) and expose every
// published participant as a switchable angle, each delivered sub-second over WebRTC — the same
// path the phone viewer + setup previews use. The phone (userId 'broadcaster') and the external
// camera (userId 'camera') are separate stage participants, so the viewer watches ONE at a time:
// no composite grid, nothing to keep in sync with each other (which is what the side-by-side
// composite couldn't do — the WHIP phone ran ~2-3s ahead of the RTMP camera inside one frame).
// The selected angle's kind is reported up so Watch holds the scorebug back by that angle's
// latency (phone ≈ 0, camera ≈ RTMP-ingest delay). The composite recording still runs server-side
// for the replay; it's just no longer the live view.
export function MultiAngleStageVideo({
  gameId,
  board,
  attempt,
  onKind,
}: {
  gameId?: string
  board: ScoreboardState
  attempt: boolean // the game is live → worth joining the stage
  onKind?: (kind: 'phone' | 'camera') => void
}) {
  const [token, setToken] = useState<string | null>(null)
  const [angles, setAngles] = useState<Angle[]>([])
  const [selPid, setSelPid] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const onKindRef = useRef(onKind)
  onKindRef.current = onKind

  // Subscribe token (mint by gameId). viewer-token 404s until the stage exists, so poll while live.
  useEffect(() => {
    if (!gameId || !attempt) {
      setToken(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const fetchTok = async () => {
      try {
        const { data } = await supabase.functions.invoke('stream-ivs', {
          body: { gameId, action: 'viewer-token' },
        })
        const t = (data as { token?: string } | null)?.token ?? null
        if (cancelled) return
        if (t) setToken(t)
        else timer = setTimeout(fetchTok, 4000)
      } catch {
        if (!cancelled) timer = setTimeout(fetchTok, 4000)
      }
    }
    void fetchTok()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [gameId, attempt])

  // Join the stage once; keep a live map of participantId -> {userId, MediaStream}. We subscribe to
  // ALL participants (so switching is instant — no renegotiation) and render only the selected one.
  useEffect(() => {
    if (!token) {
      setAngles([])
      return
    }
    let stage: Stage | null = null
    let cancelled = false
    const streams = new Map<string, Angle>()
    const publish = () => setAngles(Array.from(streams.values()))
    const pidOf = (p: StageParticipantInfo) => p.id ?? p.userId ?? 'unknown'

    const strategy = {
      stageStreamsToPublish: () => [],
      shouldPublishParticipant: () => false,
      shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
    }

    ;(async () => {
      try {
        stage = new Stage(token, strategy)
        stage.on(
          StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED,
          (p: StageParticipantInfo, ss: StageStream[]) => {
            const pid = pidOf(p)
            let a = streams.get(pid)
            if (!a) {
              a = { pid, userId: p.userId ?? '', stream: new MediaStream() }
              streams.set(pid, a)
            }
            for (const s of ss) a.stream.addTrack(s.mediaStreamTrack)
            publish()
          },
        )
        stage.on(
          StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED,
          (p: StageParticipantInfo, ss: StageStream[]) => {
            const a = streams.get(pidOf(p))
            if (!a) return
            for (const s of ss) {
              try {
                a.stream.removeTrack(s.mediaStreamTrack)
              } catch {
                /* already gone */
              }
            }
            if (a.stream.getVideoTracks().length === 0) streams.delete(a.pid)
            publish()
          },
        )
        stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (p: StageParticipantInfo) => {
          if (streams.delete(pidOf(p))) publish()
        })
        await stage.join()
        if (cancelled) stage.leave()
      } catch {
        if (!cancelled) setAngles([])
      }
    })()

    return () => {
      cancelled = true
      try {
        stage?.leave()
      } catch {
        /* not joined */
      }
      streams.forEach((a) => a.stream.getTracks().forEach((t) => a.stream.removeTrack(t)))
      streams.clear()
    }
  }, [token])

  // Keep a valid selection: default to the phone (sub-second, best-synced) when present, else the
  // first angle; hold the current pick as long as it's still publishing.
  useEffect(() => {
    if (angles.length === 0) {
      setSelPid(null)
      return
    }
    setSelPid((cur) => {
      if (cur && angles.some((a) => a.pid === cur)) return cur
      return (angles.find((a) => a.userId === 'broadcaster') ?? angles[0]).pid
    })
  }, [angles])

  const selected = angles.find((a) => a.pid === selPid) ?? null

  useEffect(() => {
    const el = videoRef.current
    if (el && selected && el.srcObject !== selected.stream) el.srcObject = selected.stream
  }, [selected])

  useEffect(() => {
    if (selected) onKindRef.current?.(selected.userId === 'camera' ? 'camera' : 'phone')
  }, [selected])

  const labels = useMemo(() => labelAngles(angles), [angles])
  const liveVideo = angles.length > 0 && !!selected

  if (!token || !liveVideo) return <ScorePanel state={board} />
  return (
    <div>
      <div className="relative bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full bg-black object-contain" />
        {angles.length > 1 && (
          <div className="absolute left-2 top-2 flex gap-1">
            {angles.map((a) => (
              <button
                key={a.pid}
                onClick={() => setSelPid(a.pid)}
                className={`border-2 px-2.5 py-1 font-athletic text-[11px] font-semibold uppercase tracking-wide ${
                  a.pid === selPid
                    ? 'border-gold bg-board-green text-cream'
                    : 'border-cream/40 bg-ink/70 text-cream/85'
                }`}
              >
                {labels[a.pid]}
              </button>
            ))}
          </div>
        )}
      </div>
      <ScorebugBar state={board} />
    </div>
  )
}

// Friendly angle labels; number a second/third camera so multiple externals stay distinct.
function labelAngles(angles: Angle[]): Record<string, string> {
  const out: Record<string, string> = {}
  let camN = 0
  for (const a of angles) {
    if (a.userId === 'broadcaster') out[a.pid] = 'Phone'
    else if (a.userId === 'camera') {
      camN++
      out[a.pid] = camN > 1 ? `Camera ${camN}` : 'Camera'
    } else out[a.pid] = a.userId || 'Angle'
  }
  return out
}
