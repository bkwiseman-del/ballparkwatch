// WebCodecs recorder: encodes the upright 16:9 broadcast canvas (+ mic audio) into a
// real MP4 using VideoEncoder/AudioEncoder + an in-browser MP4 muxer.
//
// Why this exists: MediaRecorder on iOS Safari either can't record a canvas.captureStream
// (zero bytes) or, when recording the raw camera, bakes the device's orientation into the
// file — so a landscape game comes back sideways. Here we own every pixel: we pull frames
// straight from the canvas the viewers already see, so the recording is upright by
// construction, matches the live framing exactly, and its size is bounded by a real bitrate
// cap. Falls back to MediaRecorder (in Broadcast.tsx) on browsers without WebCodecs.

import { Muxer, ArrayBufferTarget, StreamTarget } from 'mp4-muxer'

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
  // Encode resolution — defaults BELOW the canvas so the phone's second encode (this,
  // alongside the WHIP live encode) stays light and the device runs cool. The canvas is
  // downscaled into this size per frame; the live stream is unaffected.
  targetHeight?: number
  onBytes?: (total: number) => void
  // When provided, the recording is written as a FRAGMENTED mp4 and streamed out chunk by
  // chunk (append-only), so the whole game is never held in memory — the caller uploads
  // each chunk and frees it. Without it, the file is buffered in memory and returned by stop().
  onChunk?: (data: Uint8Array) => void
}): Promise<CanvasRecorder | null> {
  const { canvas, audioTrack } = opts
  const fps = opts.fps ?? 24
  const videoBitrate = opts.videoBitrate ?? 900_000
  const audioBitrate = opts.audioBitrate ?? 96_000
  // Downscale to the target height (default 480p), preserving the canvas aspect ratio;
  // round width to even (H.264 requires even dimensions).
  const srcW = canvas.width || 1280
  const srcH = canvas.height || 720
  const targetH = Math.min(opts.targetHeight ?? 480, srcH)
  const height = targetH
  const width = Math.round((srcW / srcH) * targetH / 2) * 2
  const needScale = width !== srcW || height !== srcH
  const scaleCanvas = needScale ? document.createElement('canvas') : null
  if (scaleCanvas) {
    scaleCanvas.width = width
    scaleCanvas.height = height
  }
  const scaleCtx = scaleCanvas?.getContext('2d') ?? null
  // The frame source we hand VideoEncoder each tick: the downscaled canvas, or the
  // original if no scaling is needed.
  const frameSource = (): HTMLCanvasElement => {
    if (scaleCanvas && scaleCtx) {
      scaleCtx.drawImage(canvas, 0, 0, width, height)
      return scaleCanvas
    }
    return canvas
  }

  // Bail (→ MediaRecorder fallback) if the browser can't H.264-encode this frame. The
  // heat win comes from the 480p downscale, not a hardware hint — Safari rejects the
  // `hardwareAcceleration` config outright (0-byte recordings), so we DON'T set it.
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

  const streaming = !!opts.onChunk
  const muxer = new Muxer({
    target: streaming
      ? // Fragmented fMP4 streamed out ~4MB at a time — nothing large stays in memory.
        new StreamTarget({ onData: (data) => opts.onChunk!(data), chunked: true, chunkSize: 4 * 1024 * 1024 })
      : new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    ...(wantAudio ? { audio: { codec: 'aac', numberOfChannels: channels, sampleRate } } : {}),
    // Streaming → fragmented (append-only, low memory). Otherwise buffer in memory and put
    // the moov atom at the front so the returned file is seekable.
    fastStart: streaming ? 'fragmented' : 'in-memory',
    ...(streaming ? { minFragmentDuration: 2 } : {}),
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
        const frame = new g.VideoFrame(frameSource(), { timestamp: Math.round(elapsed * 1000), duration: frameDurUs })
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
    muxer.finalize() // streaming → flushes the final fragment via onChunk (already uploaded)
    if (streaming) return null
    const { buffer } = muxer.target as ArrayBufferTarget
    return new Blob([buffer], { type: 'video/mp4' })
  }

  return { mimeType: 'video/mp4', bytes: () => bytes, stop }
}
