import { useEffect, useState } from 'react'
import { Stage, SubscribeType, StageEvents, type StageParticipantInfo, type StageStream } from 'amazon-ivs-web-broadcast'
import { supabase } from '@/lib/supabase'

// Real "is the camera's VIDEO actually reaching the stream?" check — the fix for the false green
// light (the old status only knew the participant was *publishing*, and audio keeps it published
// even when the video has starved on a thin uplink, e.g. a cellular hotspot). We subscribe to the
// stage as a `health` probe (NOT a viewer — never counted toward the 5-viewer cap) and watch the
// external camera participant's video MediaStreamTrack: a remote track reports `muted = true` /
// `readyState !== 'live'` when no media is flowing. So audio-only-with-black-video shows 'starved'.
//
// 'ok'       — camera video is flowing.
// 'starved'  — camera is connected but NO video is getting through (warn the scorer).
// 'unknown'  — no external camera on the stage yet / still settling (don't alarm).
export function useCameraVideoHealth(gameId: string | undefined, active: boolean): 'ok' | 'starved' | 'unknown' {
  const [status, setStatus] = useState<'ok' | 'starved' | 'unknown'>('unknown')
  useEffect(() => {
    if (!gameId || !active) {
      setStatus('unknown')
      return
    }
    let cancelled = false
    let stage: Stage | null = null
    let camVideo: MediaStreamTrack | null = null
    let camFirstSeen = 0
    let lastOk = 0

    const evaluate = () => {
      if (cancelled) return
      if (!camFirstSeen) return void setStatus('unknown') // no external camera present
      const now = performance.now()
      const flowing = !!camVideo && !camVideo.muted && camVideo.readyState === 'live'
      if (flowing) {
        lastOk = now
        setStatus('ok')
        return
      }
      // Not flowing — only call it starved after a grace window from first-seen / last-good, so a
      // brief startup gap or a momentary blip doesn't false-alarm.
      const since = Math.max(lastOk, camFirstSeen)
      setStatus(now - since > 6000 ? 'starved' : 'unknown')
    }

    ;(async () => {
      try {
        const { data } = await supabase.functions.invoke('stream-ivs', {
          body: { gameId, action: 'viewer-token', role: 'health' },
        })
        const token = (data as { token?: string } | null)?.token
        if (!token || cancelled) return
        stage = new Stage(token, {
          stageStreamsToPublish: () => [],
          shouldPublishParticipant: () => false,
          shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
        })
        stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (p: StageParticipantInfo, ss: StageStream[]) => {
          if (p.userId !== 'camera') return // only the external RTMP camera
          if (!camFirstSeen) camFirstSeen = performance.now()
          const vt = ss.map((s) => s.mediaStreamTrack).find((t) => t.kind === 'video')
          if (vt) {
            camVideo = vt
            vt.onmute = evaluate
            vt.onunmute = evaluate
            vt.onended = evaluate
          }
          evaluate()
        })
        stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED, (p: StageParticipantInfo, ss: StageStream[]) => {
          if (p.userId !== 'camera') return
          if (ss.some((s) => s.mediaStreamTrack === camVideo)) camVideo = null
          evaluate()
        })
        stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (p: StageParticipantInfo) => {
          if (p.userId !== 'camera') return
          camFirstSeen = 0
          camVideo = null
          evaluate()
        })
        await stage.join()
        if (cancelled) stage.leave()
      } catch {
        /* best-effort; never block the scorer on a probe hiccup */
      }
    })()

    // Re-evaluate on a timer too — muted/readyState can change without always firing an event.
    const timer = window.setInterval(evaluate, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      try {
        stage?.leave()
      } catch {
        /* not joined */
      }
    }
  }, [gameId, active])
  return status
}
