import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// Peer-to-peer phone video for "another phone" games. Any viewer can tap Go Live
// to become the broadcaster; everyone else receives the stream. Signaling rides
// the Supabase Realtime channel (offer/answer/ICE); media is direct WebRTC.
//
// Single broadcaster, newest-wins: tapping Go Live announces a start timestamp;
// an older broadcaster that hears a newer one yields and becomes a viewer.
//
// STUN-only for now — reliable on the same network; some cross-network NATs will
// need a TURN relay (a fast follow if real-world tests fail to connect).

const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  // Free public TURN relay (Metered Open Relay) so cross-network connects work
  // without an account. The ice-servers function can upgrade this to a paid
  // relay if TURN creds are configured.
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]
export const videoChannelName = (gameId: string) => `bpw:video:${gameId}`
const HEARTBEAT_MS = 2000
const LIVE_TIMEOUT_MS = 6000

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

type Sig =
  | { kind: 'live'; from: string; ts: number; viewers?: number }
  | { kind: 'hello'; from: string }
  | { kind: 'bye'; from: string }
  | { kind: 'kill'; from: string } // scorer tells the broadcaster to stop filming
  | { kind: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }

export type ZoomRange = { min: number; max: number; step: number }
export type CameraInfo = { deviceId: string; label: string }

export type PhoneVideo = {
  isLive: boolean // someone (possibly us) is broadcasting
  isBroadcasting: boolean // we are the broadcaster
  incoming: MediaStream | null // the feed we're watching
  local: MediaStream | null // the broadcast feed (16:9 canvas) — what viewers see
  getCameraStream: () => MediaStream | null // raw camera+mic — recordable on iOS (canvas isn't)
  viewers: number // connected viewers (broadcaster side)
  error: string | null
  cameras: CameraInfo[] // available cameras (e.g. iPhone wide / ultrawide / front)
  cameraId: string | null // the active camera's deviceId
  zoom: number
  zoomRange: ZoomRange | null // null when the camera/browser doesn't expose zoom
  goLive: () => Promise<void>
  selectCamera: (deviceId: string) => Promise<void>
  setZoom: (z: number) => void
  stop: () => void
  kill: () => void // scorer-side: remotely terminate the broadcaster
}

// Ask for a roughly-720p stream. iOS Safari often ignores aspectRatio and hands
// back 4:3 regardless, so we don't over-constrain — the viewer shows whatever
// shape comes back at its natural ratio rather than letterboxing it.
function videoConstraints(opts: { deviceId?: string } = {}): MediaTrackConstraints {
  const base: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } }
  return opts.deviceId
    ? { ...base, deviceId: { exact: opts.deviceId } }
    : { ...base, facingMode: 'environment' }
}

export function usePhoneVideo(gameId: string | undefined, active: boolean): PhoneVideo {
  const [isLive, setIsLive] = useState(false)
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [incoming, setIncoming] = useState<MediaStream | null>(null)
  const [local, setLocal] = useState<MediaStream | null>(null)
  const [viewers, setViewers] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cameras, setCameras] = useState<CameraInfo[]>([])
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [zoom, setZoomState] = useState(1)
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)

  const me = useRef(rid())
  const chan = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localRef = useRef<MediaStream | null>(null) // the 16:9 canvas output we broadcast
  const camStreamRef = useRef<MediaStream | null>(null) // raw camera (any aspect)
  const camVideoRef = useRef<HTMLVideoElement | null>(null) // hidden <video> of the camera
  const canvasRef = useRef<HTMLCanvasElement | null>(null) // 16:9 crop surface
  const rafRef = useRef<number | undefined>(undefined)
  const iceRef = useRef<RTCIceServer[]>(ICE)
  const bcastRef = useRef(false)
  const startTs = useRef(0)
  const curBc = useRef<string | null>(null) // current broadcaster id (viewer side)
  const heartbeat = useRef<number | undefined>(undefined)
  const liveTimer = useRef<number | undefined>(undefined)

  const send = useCallback((m: Sig) => {
    chan.current?.send({ type: 'broadcast', event: 'sig', payload: m })
  }, [])

  // Fetch TURN/STUN servers once — TURN relays make cross-network connects work
  // (LTE ↔ home wifi). Falls back to the bundled STUN list on any failure.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    supabase.functions
      .invoke('ice-servers')
      .then(({ data }) => {
        if (!cancelled && Array.isArray(data?.iceServers) && data.iceServers.length) {
          iceRef.current = data.iceServers as RTCIceServer[]
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active])

  const closePc = useCallback((id: string) => {
    const pc = pcs.current.get(id)
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.close()
      pcs.current.delete(id)
    }
    setViewers(pcs.current.size)
  }, [])

  const teardownBroadcast = useCallback(() => {
    bcastRef.current = false
    setIsBroadcasting(false)
    window.clearInterval(heartbeat.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = undefined
    for (const id of [...pcs.current.keys()]) closePc(id)
    localRef.current?.getTracks().forEach((t) => t.stop())
    camStreamRef.current?.getTracks().forEach((t) => t.stop())
    localRef.current = null
    camStreamRef.current = null
    camVideoRef.current = null
    canvasRef.current = null
    setLocal(null)
    setViewers(0)
  }, [closePc])

  // Broadcaster → create a sending peer connection for a viewer and offer.
  const offerTo = useCallback(
    async (subId: string) => {
      if (!bcastRef.current || pcs.current.has(subId) || !localRef.current) return
      const pc = new RTCPeerConnection({ iceServers: iceRef.current })
      pcs.current.set(subId, pc)
      setViewers(pcs.current.size)
      localRef.current.getTracks().forEach((t) => pc.addTrack(t, localRef.current!))
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ kind: 'ice', from: me.current, to: subId, candidate: e.candidate.toJSON() })
      }
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePc(subId)
      }
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        send({ kind: 'offer', from: me.current, to: subId, sdp: offer })
      } catch {
        closePc(subId)
      }
    },
    [send, closePc],
  )

  // Viewer → handle an offer from the broadcaster and answer.
  const onOffer = useCallback(
    async (bcId: string, sdp: RTCSessionDescriptionInit) => {
      closePc(bcId)
      const pc = new RTCPeerConnection({ iceServers: iceRef.current })
      pcs.current.set(bcId, pc)
      curBc.current = bcId
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ kind: 'ice', from: me.current, to: bcId, candidate: e.candidate.toJSON() })
      }
      pc.ontrack = (e) => setIncoming(e.streams[0] ?? null)
      try {
        await pc.setRemoteDescription(sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send({ kind: 'answer', from: me.current, to: bcId, sdp: answer })
      } catch {
        closePc(bcId)
      }
    },
    [send, closePc],
  )

  useEffect(() => {
    if (!gameId || !active) return
    const ch = supabase.channel(videoChannelName(gameId), { config: { broadcast: { self: false } } })
    chan.current = ch

    const markLive = (from: string) => {
      curBc.current = from
      setIsLive(true)
      window.clearTimeout(liveTimer.current)
      liveTimer.current = window.setTimeout(() => {
        setIsLive(false)
        setIncoming(null)
        curBc.current = null
      }, LIVE_TIMEOUT_MS)
    }

    ch.on('broadcast', { event: 'sig' }, ({ payload }) => {
      const m = payload as Sig
      if (!m || m.from === me.current) return
      switch (m.kind) {
        case 'live': {
          if (bcastRef.current) {
            // Another broadcaster is live. Newest start wins.
            if (m.ts > startTs.current) {
              teardownBroadcast()
              markLive(m.from)
              send({ kind: 'hello', from: me.current })
            }
          } else {
            const isNew = curBc.current !== m.from || !pcs.current.has(m.from)
            markLive(m.from)
            setViewers(m.viewers ?? 0) // viewer-side: show the broadcaster's reported count
            if (isNew) send({ kind: 'hello', from: me.current })
          }
          break
        }
        case 'kill':
          // The scorer remotely terminated the feed — if we're filming, stop.
          if (bcastRef.current) teardownBroadcast()
          break
        case 'hello':
          if (bcastRef.current) offerTo(m.from)
          break
        case 'offer':
          if (!bcastRef.current && m.to === me.current) onOffer(m.from, m.sdp)
          break
        case 'answer':
          if (bcastRef.current && m.to === me.current) {
            pcs.current.get(m.from)?.setRemoteDescription(m.sdp).catch(() => {})
          }
          break
        case 'ice':
          if (m.to === me.current) {
            pcs.current.get(m.from)?.addIceCandidate(m.candidate).catch(() => {})
          }
          break
        case 'bye':
          if (bcastRef.current) {
            closePc(m.from)
          } else if (m.from === curBc.current) {
            closePc(m.from)
            setIncoming(null)
            setIsLive(false)
            curBc.current = null
          }
          break
      }
    }).subscribe((status) => {
      if (status === 'SUBSCRIBED') send({ kind: 'hello', from: me.current })
    })

    return () => {
      send({ kind: 'bye', from: me.current })
      window.clearInterval(heartbeat.current)
      window.clearTimeout(liveTimer.current)
      for (const id of [...pcs.current.keys()]) closePc(id)
      localRef.current?.getTracks().forEach((t) => t.stop())
      localRef.current = null
      supabase.removeChannel(ch)
      chan.current = null
    }
  }, [gameId, active, send, offerTo, onOffer, closePc, teardownBroadcast])

  // Read whether the current camera supports zoom, and expose its range.
  const readZoom = useCallback((track: MediaStreamTrack) => {
    const caps = (track.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number; step?: number } }
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step ?? 0.1 })
      const cur = (track.getSettings?.() as { zoom?: number }).zoom
      setZoomState(cur ?? caps.zoom.min)
    } else {
      setZoomRange(null)
    }
  }, [])

  // List available cameras. Labels are only populated after camera permission
  // has been granted (i.e. after goLive), so we call this then.
  const enumerate = useCallback(async () => {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices()
      const cams = devs
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
      setCameras(cams)
    } catch {
      /* ignore */
    }
  }, [])

  // Point the hidden <video> at a camera stream (creating it on first use).
  const attachCamera = useCallback((cam: MediaStream) => {
    camStreamRef.current = cam
    let v = camVideoRef.current
    if (!v) {
      v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      camVideoRef.current = v
    }
    v.srcObject = cam
    v.play().catch(() => {})
    const vt = cam.getVideoTracks()[0]
    setCameraId(vt.getSettings().deviceId ?? null)
    readZoom(vt)
  }, [readZoom])

  const goLive = useCallback(async () => {
    setError(null)
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(),
        audio: true,
      })
      attachCamera(cam)
      enumerate()

      // Crop whatever the camera gives us (often 4:3 on iOS) into a true 16:9
      // canvas, and broadcast the canvas — guarantees a widescreen feed.
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      canvasRef.current = canvas
      const ctx = canvas.getContext('2d')!
      const draw = () => {
        const v = camVideoRef.current
        if (v && v.videoWidth) {
          const sw = v.videoWidth
          const sh = v.videoHeight
          const targetAR = 16 / 9
          let sx = 0
          let sy = 0
          let scw = sw
          let sch = sh
          if (sw / sh > targetAR) {
            scw = sh * targetAR
            sx = (sw - scw) / 2
          } else {
            sch = sw / targetAR
            sy = (sh - sch) / 2
          }
          ctx.drawImage(v, sx, sy, scw, sch, 0, 0, canvas.width, canvas.height)
        }
        rafRef.current = requestAnimationFrame(draw)
      }
      draw()

      const out = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30)
      cam.getAudioTracks().forEach((t) => out.addTrack(t))
      localRef.current = out
      setLocal(out)

      setIncoming(null)
      for (const id of [...pcs.current.keys()]) closePc(id) // drop any viewer PCs we held
      bcastRef.current = true
      setIsBroadcasting(true)
      startTs.current = Date.now()
      setIsLive(true)
      const beat = () =>
        send({ kind: 'live', from: me.current, ts: startTs.current, viewers: pcs.current.size })
      beat()
      heartbeat.current = window.setInterval(beat, HEARTBEAT_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not access the camera.')
    }
  }, [send, closePc, enumerate, attachCamera])

  // Switch to a specific camera by deviceId — lets iPhone users pick the wide /
  // ultrawide / front lens. We only swap the source of the canvas pipeline, so
  // the outgoing 16:9 track is unchanged (no peer renegotiation needed). Audio
  // from the original capture is preserved.
  const selectCamera = useCallback(
    async (deviceId: string) => {
      if (!bcastRef.current) return
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints({ deviceId }),
        })
        const newVideo = fresh.getVideoTracks()[0]
        const audio = camStreamRef.current?.getAudioTracks() ?? []
        camStreamRef.current?.getVideoTracks().forEach((t) => t.stop())
        attachCamera(new MediaStream([newVideo, ...audio]))
        enumerate()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not switch cameras.')
      }
    },
    [enumerate, attachCamera],
  )

  const setZoom = useCallback((z: number) => {
    // Zoom applies to the real camera track, not the canvas output.
    const track = camStreamRef.current?.getVideoTracks()[0]
    if (!track) return
    setZoomState(z)
    // `zoom` isn't in the standard constraint typings.
    track
      .applyConstraints({ advanced: [{ zoom: z }] } as unknown as MediaTrackConstraints)
      .catch(() => {})
  }, [])

  const stop = useCallback(() => {
    send({ kind: 'bye', from: me.current })
    teardownBroadcast()
    setIsLive(false)
    setZoomRange(null)
    send({ kind: 'hello', from: me.current }) // rejoin as a viewer if someone else picks up
  }, [send, teardownBroadcast])

  // Scorer-side: remotely terminate whoever is filming (a safety control).
  const kill = useCallback(() => {
    send({ kind: 'kill', from: me.current })
    setIncoming(null)
    setIsLive(false)
    curBc.current = null
  }, [send])

  return {
    isLive,
    isBroadcasting,
    incoming,
    local,
    getCameraStream: () => camStreamRef.current,
    viewers,
    error,
    cameras,
    cameraId,
    zoom,
    zoomRange,
    goLive,
    selectCamera,
    setZoom,
    stop,
    kill,
  }
}

// live: heartbeats arriving now. down: the feed WAS live and heartbeats then
// stopped without a clean stop (broadcaster phone locked / lost signal / crashed)
// — the actionable "your video died" state. secsSinceBeat: seconds since the last
// heartbeat (null if we've never seen one), for a live "no signal for Ns" readout.
export type BroadcastStatus = { live: boolean; viewers: number; down: boolean; secsSinceBeat: number | null }

// Passive monitor (no media, no signaling) for the scorer: listens for the
// broadcaster's heartbeats so we can show whether a phone livestream is
// happening and healthy, and flags it DOWN if heartbeats stop unexpectedly.
export function useBroadcastStatus(gameId: string | undefined, active: boolean): BroadcastStatus {
  const [live, setLive] = useState(false)
  const [viewers, setViewers] = useState(0)
  const [down, setDown] = useState(false)
  const [secsSinceBeat, setSecs] = useState<number | null>(null)
  const bc = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const everLive = useRef(false) // a feed has been seen since we started watching
  const lastBeat = useRef<number | null>(null)

  useEffect(() => {
    if (!gameId || !active) {
      setLive(false)
      setViewers(0)
      setDown(false)
      setSecs(null)
      everLive.current = false
      lastBeat.current = null
      return
    }
    const ch = supabase.channel(videoChannelName(gameId), { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'sig' }, ({ payload }) => {
      const m = payload as Sig
      if (m?.kind === 'live') {
        bc.current = m.from
        everLive.current = true
        lastBeat.current = Date.now()
        setLive(true)
        setDown(false)
        setViewers(m.viewers ?? 0)
        window.clearTimeout(timer.current)
        // Heartbeats vanished → if a feed had been running, it DIED (not a clean stop).
        timer.current = window.setTimeout(() => {
          setLive(false)
          setViewers(0)
          if (everLive.current) setDown(true)
        }, LIVE_TIMEOUT_MS)
      } else if (m?.kind === 'bye' && m.from === bc.current) {
        // Clean stop — not a failure.
        setLive(false)
        setViewers(0)
        setDown(false)
        everLive.current = false
        lastBeat.current = null
        window.clearTimeout(timer.current)
      }
    }).subscribe()
    // Tick the "seconds since last heartbeat" readout once a second.
    const tick = window.setInterval(() => {
      setSecs(lastBeat.current ? Math.floor((Date.now() - lastBeat.current) / 1000) : null)
    }, 1000)
    return () => {
      window.clearTimeout(timer.current)
      window.clearInterval(tick)
      supabase.removeChannel(ch)
    }
  }, [gameId, active])

  return { live, viewers, down, secsSinceBeat }
}
