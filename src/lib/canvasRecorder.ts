// WebCodecs recorder: encodes the upright 16:9 broadcast canvas (+ mic audio) into a
// real MP4 using VideoEncoder/AudioEncoder + an in-browser MP4 muxer.
//
// Why this exists: MediaRecorder on iOS Safari either can't record a canvas.captureStream
// (zero bytes) or, when recording the raw camera, bakes the device's orientation into the
// file — so a landscape game comes back sideways. Here we own every pixel: we pull frames
// straight from the canvas the viewers already see, so the recording is upright by
// construction, matches the live framing exactly, and its size is bounded by a real bitrate
// cap. Falls back to MediaRecorder (in Broadcast.tsx) on browsers without WebCodecs.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

// WebCodecs isn't in every TS lib target; keep the surface we touch loosely typed.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyEncoder = {
  configure: (c: any) => void
  encode: (frame: any, opts?: any) => void
  flush: () => Promise<void>
  close: () => void
  encodeQueueSize: number
  state: string
}

export type CanvasRecorder = {
  mimeType: string
  bytes: () => number
  // Finalize the file and return it. Call BEFORE the canvas/audio tracks are torn down.
  stop: () => Promise<Blob | null>
}

const g = globalThis as any

export function webCodecsSupported(): boolean {
  return (
    typeof g.VideoEncoder === 'function' &&
    typeof g.VideoFrame === 'function' &&
    typeof g.AudioEncoder === 'function' &&
    typeof g.AudioData === 'function'
  )
}

// H.264 baseline @ level 3.1 covers 1280×720p30. Baseline maximizes decode compatibility.
const AVC_CODEC = 'avc1.42E01F'
const AAC_CODEC = 'mp4a.40.2'

export async function startCanvasRecording(opts: {
  canvas: HTMLCanvasElement
  audioTrack: MediaStreamTrack | null
  videoBitrate?: number
  audioBitrate?: number
  fps?: number
  onBytes?: (total: number) => void
}): Promise<CanvasRecorder | null> {
  const { canvas, audioTrack } = opts
  const fps = opts.fps ?? 30
  const videoBitrate = opts.videoBitrate ?? 1_200_000
  const audioBitrate = opts.audioBitrate ?? 96_000
  const width = canvas.width || 1280
  const height = canvas.height || 720

  // Bail (→ MediaRecorder fallback) if the browser can't H.264-encode this frame.
  try {
    const ok = await g.VideoEncoder.isConfigSupported({ codec: AVC_CODEC, width, height, bitrate: videoBitrate, framerate: fps })
    if (!ok?.supported) return null
  } catch {
    return null
  }

  // Audio is best-effort: if AAC encoding isn't supported we still ship an upright
  // video-only replay rather than nothing.
  let audioCtx: any = null
  let sampleRate = 0
  let channels = 1
  let wantAudio = false
  if (audioTrack) {
    try {
      audioCtx = new (g.AudioContext || g.webkitAudioContext)()
      sampleRate = audioCtx.sampleRate
      const supported = await g.AudioEncoder.isConfigSupported({
        codec: AAC_CODEC,
        numberOfChannels: channels,
        sampleRate,
        bitrate: audioBitrate,
      })
      wantAudio = !!supported?.supported
    } catch {
      wantAudio = false
    }
    if (!wantAudio && audioCtx) {
      try {
        await audioCtx.close()
      } catch {
        /* ignore */
      }
      audioCtx = null
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    ...(wantAudio ? { audio: { codec: 'aac', numberOfChannels: channels, sampleRate } } : {}),
    // Rewrite the moov atom to the front so the stored file is seekable on progressive
    // download — the replay seeks straight to the first pitch.
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })

  let bytes = 0
  const frameDurUs = Math.round(1_000_000 / fps) // each VideoFrame carries this duration
  const videoEnc: AnyEncoder = new g.VideoEncoder({
    output: (chunk: any, meta: any) => {
      try {
        muxer.addVideoChunk(chunk, meta)
        bytes += chunk.byteLength ?? 0
        opts.onBytes?.(bytes)
      } catch {
        /* drop a bad chunk rather than kill the recording */
      }
    },
    error: () => {},
  })
  videoEnc.configure({
    codec: AVC_CODEC,
    width,
    height,
    bitrate: videoBitrate,
    framerate: fps,
    // Emit avcC-formatted chunks (with a decoder description) so the muxer can write them.
    avc: { format: 'avc' },
    latencyMode: 'realtime',
  })

  let audioEnc: AnyEncoder | null = null
  if (wantAudio && audioCtx) {
    const ae: AnyEncoder = new g.AudioEncoder({
      output: (chunk: any, meta: any) => {
        bytes += chunk.byteLength ?? 0
        muxer.addAudioChunk(chunk, meta)
      },
      error: () => {},
    })
    ae.configure({ codec: AAC_CODEC, numberOfChannels: channels, sampleRate, bitrate: audioBitrate })
    audioEnc = ae
  }

  // ---- Video: sample the canvas at ~fps and encode, keyframe every 2s ----
  const startPerf = performance.now()
  const frameInterval = 1000 / fps
  let nextFrameAt = 0
  let frameCount = 0
  let raf = 0
  let stopped = false

  const pump = () => {
    if (stopped) return
    const elapsed = performance.now() - startPerf
    if (elapsed >= nextFrameAt && videoEnc.state === 'configured') {
      // Don't let the encoder queue run away on a slow phone — skip a frame instead.
      if (videoEnc.encodeQueueSize < 6) {
        const frame = new g.VideoFrame(canvas, { timestamp: Math.round(elapsed * 1000), duration: frameDurUs })
        const keyFrame = frameCount % (fps * 2) === 0
        try {
          videoEnc.encode(frame, { keyFrame })
        } catch {
          /* drop */
        }
        frame.close()
        frameCount++
      }
      nextFrameAt += frameInterval
      if (nextFrameAt < elapsed) nextFrameAt = elapsed + frameInterval // resync after a stall
    }
    raf = requestAnimationFrame(pump)
  }
  raf = requestAnimationFrame(pump)

  // ---- Audio: pull PCM off the mic via Web Audio, feed AudioData to the encoder ----
  let scriptNode: any = null
  let sourceNode: any = null
  let muteGain: any = null
  let audioTsUs = 0
  if (audioEnc && audioCtx && audioTrack) {
    try {
      const ms = new MediaStream([audioTrack])
      sourceNode = audioCtx.createMediaStreamSource(ms)
      // ScriptProcessorNode is deprecated but is the one PCM tap that works on iOS Safari.
      scriptNode = audioCtx.createScriptProcessor(4096, 1, 1)
      muteGain = audioCtx.createGain()
      muteGain.gain.value = 0 // route to destination silently so the node actually runs (no feedback)
      scriptNode.onaudioprocess = (e: any) => {
        if (stopped || !audioEnc || audioEnc.state !== 'configured') return
        const input: Float32Array = e.inputBuffer.getChannelData(0)
        const copy = new Float32Array(input.length)
        copy.set(input)
        try {
          const data = new g.AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfFrames: copy.length,
            numberOfChannels: channels,
            timestamp: audioTsUs,
            data: copy,
          })
          audioEnc.encode(data)
          data.close()
        } catch {
          /* drop */
        }
        audioTsUs += Math.round((copy.length / sampleRate) * 1_000_000)
      }
      sourceNode.connect(scriptNode)
      scriptNode.connect(muteGain)
      muteGain.connect(audioCtx.destination)
      if (audioCtx.state === 'suspended') await audioCtx.resume()
    } catch {
      audioEnc = null // audio wiring failed — keep going video-only
    }
  }

  const stop = async (): Promise<Blob | null> => {
    if (stopped) return null
    stopped = true
    cancelAnimationFrame(raf)
    try {
      if (scriptNode) scriptNode.onaudioprocess = null
      sourceNode?.disconnect()
      scriptNode?.disconnect()
      muteGain?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      if (videoEnc.state !== 'closed') await videoEnc.flush()
    } catch {
      /* ignore */
    }
    try {
      if (audioEnc && audioEnc.state !== 'closed') await audioEnc.flush()
    } catch {
      /* ignore */
    }
    try {
      videoEnc.close()
      audioEnc?.close()
    } catch {
      /* ignore */
    }
    try {
      await audioCtx?.close()
    } catch {
      /* ignore */
    }
    if (frameCount === 0) return null
    muxer.finalize()
    const { buffer } = muxer.target as ArrayBufferTarget
    return new Blob([buffer], { type: 'video/mp4' })
  }

  return { mimeType: 'video/mp4', bytes: () => bytes, stop }
}
