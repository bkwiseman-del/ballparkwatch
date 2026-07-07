import { Stage, LocalStageStream, SubscribeType, type StageParticipantInfo } from 'amazon-ivs-web-broadcast'

// Publish a MediaStream (the broadcaster's upright 16:9 canvas + mic audio) to an IVS Real-Time
// stage via the Web Broadcast SDK — robust cross-browser WHIP publishing (handles the SDP/stereo
// details raw WHIP doesn't). Publish-only (subscribe to no one). Returns a leave() handle.
export async function publishToStage(
  token: string,
  media: MediaStream,
): Promise<{ close: () => void }> {
  const streams: LocalStageStream[] = []
  const videoTrack = media.getVideoTracks()[0]
  const audioTrack = media.getAudioTracks()[0]
  if (videoTrack) streams.push(new LocalStageStream(videoTrack))
  if (audioTrack) streams.push(new LocalStageStream(audioTrack))

  const strategy = {
    stageStreamsToPublish: () => streams,
    shouldPublishParticipant: (_p: StageParticipantInfo) => true,
    shouldSubscribeToParticipant: (_p: StageParticipantInfo) => SubscribeType.NONE,
  }
  const stage = new Stage(token, strategy)
  await stage.join()
  return {
    close: () => {
      try {
        stage.leave()
      } catch {
        /* not joined */
      }
    },
  }
}
