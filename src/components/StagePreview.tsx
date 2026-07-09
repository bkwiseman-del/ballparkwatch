import { useEffect, useRef, useState } from 'react'
import {
  Stage,
  SubscribeType,
  StageEvents,
  type StageParticipantInfo,
  type StageStream,
} from 'amazon-ivs-web-broadcast'

// Sub-second preview of an IVS stage's incoming feed (camera or phone), for the setup screen.
// The camera/phone publishes to the stage the moment it connects — independent of the recording
// composition or the live channel — so the operator can confirm the actual video is arriving
// BEFORE first pitch. We join the stage as a SUBSCRIBE-only participant and render the first
// remote video track. (Same subscribe path Build 3 uses for sub-second phone viewing.)
export function StagePreview({
  token,
  className,
  onLive,
  only,
}: {
  token: string | null
  className?: string
  onLive?: (live: boolean) => void
  // Multi-angle: two previews subscribe to the SAME stage, so each must render ONLY its own
  // publisher (by participant userId: 'camera' for RTMP ingest, 'broadcaster' for the phone) —
  // otherwise every remote track lands in every preview and the last publisher wins the screen.
  // Omitted (single-publisher games) = render whatever remote video arrives, as before.
  only?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onLiveRef = useRef(onLive)
  onLiveRef.current = onLive
  const [live, setLive] = useState(false)

  useEffect(() => {
    if (!token) return
    let stage: Stage | null = null
    let cancelled = false
    const media = new MediaStream()

    const sync = () => {
      const el = videoRef.current
      if (el && el.srcObject !== media) el.srcObject = media
      const has = media.getVideoTracks().length > 0
      setLive(has)
      onLiveRef.current?.(has)
    }

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
          (p: StageParticipantInfo, streams: StageStream[]) => {
            if (only && p.userId !== only) return // this preview renders only its own angle
            for (const s of streams) media.addTrack(s.mediaStreamTrack)
            sync()
          },
        )
        stage.on(
          StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED,
          (_p: StageParticipantInfo, streams: StageStream[]) => {
            for (const s of streams) {
              try {
                media.removeTrack(s.mediaStreamTrack)
              } catch {
                /* already gone */
              }
            }
            sync()
          },
        )
        await stage.join()
        if (cancelled) stage.leave()
      } catch {
        setLive(false)
        onLiveRef.current?.(false)
      }
    })()

    return () => {
      cancelled = true
      try {
        stage?.leave()
      } catch {
        /* not joined */
      }
      media.getTracks().forEach((t) => media.removeTrack(t))
    }
  }, [token, only])

  return (
    <div className={className}>
      <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full bg-black object-contain" />
      {!live && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-data text-sm text-cream/70">
          Waiting for camera…
        </div>
      )}
    </div>
  )
}
