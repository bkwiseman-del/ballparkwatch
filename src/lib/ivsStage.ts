import {
  Stage,
  LocalStageStream,
  SubscribeType,
  StageEvents,
  StageConnectionState,
  type StageParticipantInfo,
} from 'amazon-ivs-web-broadcast'

export type PublishState = 'connecting' | 'live' | 'reconnecting' | 'error'

// Publish a MediaStream (the broadcaster's upright 16:9 canvas + mic audio) to an IVS Real-Time
// stage via the Web Broadcast SDK. Monitors the connection and AUTO-RECONNECTS on a drop — the
// phone rejoins on its own, and IVS resumes it into the same stage/recording. onState drives the
// broadcaster's own live/reconnecting indicator (and, via the heartbeat, the scorer's alert).
export async function publishToStage(
  token: string,
  media: MediaStream,
  onState?: (s: PublishState) => void,
): Promise<{ close: () => void }> {
  let stage: Stage | null = null
  let closed = false
  let downTimer: ReturnType<typeof setTimeout> | undefined

  const strategy = {
    stageStreamsToPublish: () => {
      const streams: LocalStageStream[] = []
      const videoTrack = media.getVideoTracks()[0]
      const audioTrack = media.getAudioTracks()[0]
      if (videoTrack) streams.push(new LocalStageStream(videoTrack))
      if (audioTrack) streams.push(new LocalStageStream(audioTrack))
      return streams
    },
    shouldPublishParticipant: (_p: StageParticipantInfo) => true,
    shouldSubscribeToParticipant: (_p: StageParticipantInfo) => SubscribeType.NONE,
  }

  const clearDown = () => {
    if (downTimer) {
      clearTimeout(downTimer)
      downTimer = undefined
    }
  }

  // Manual rejoin — only used if the SDK hasn't recovered on its own after a grace period.
  const rejoin = async () => {
    if (closed) return
    try {
      stage?.leave()
    } catch {
      /* already gone */
    }
    build()
    try {
      await stage!.join()
    } catch {
      if (!closed && !downTimer) downTimer = setTimeout(() => void rejoin(), 3000)
    }
  }

  function build() {
    stage = new Stage(token, strategy)
    stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (s: StageConnectionState) => {
      if (closed) return
      if (s === StageConnectionState.CONNECTED) {
        clearDown() // recovered (SDK self-healed or our rejoin landed)
        onState?.('live')
      } else if (s === StageConnectionState.CONNECTING) {
        onState?.('reconnecting')
      } else if (s === StageConnectionState.DISCONNECTED || s === StageConnectionState.ERRORED) {
        onState?.('reconnecting')
        // Give the SDK a few seconds to self-recover; if it doesn't, rejoin ourselves.
        if (!downTimer) downTimer = setTimeout(() => void rejoin(), 4000)
      }
    })
  }

  onState?.('connecting')
  build()
  await stage!.join()

  return {
    close: () => {
      closed = true
      clearDown()
      try {
        stage?.leave()
      } catch {
        /* not joined */
      }
    },
  }
}
