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
]
export const videoChannelName = (gameId: string) => `bpw:video:${gameId}`
const HEARTBEAT_MS = 2000
const LIVE_TIMEOUT_MS = 6000

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

type Sig =
  | { kind: 'live'; from: string; ts: number; viewers?: number }
  | { kind: 'hello'; from: string }
  | { kind: 'bye'; from: string }
  | { kind: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }

export type Facing = 'environment' | 'user'
export type ZoomRange = { min: number; max: number; step: number }

export type PhoneVideo = {
  isLive: boolean // someone (possibly us) is broadcasting
  isBroadcasting: boolean // we are the broadcaster
  incoming: MediaStream | null // the feed we're watching
  local: MediaStream | null // our own camera (when broadcasting)
  viewers: number // connected viewers (broadcaster side)
  error: string | null
  facing: Facing // which camera is in use
  zoom: number
  zoomRange: ZoomRange | null // null when the camera/browser doesn't expose zoom
  goLive: () => Promise<void>
  switchCamera: () => Promise<void>
  setZoom: (z: number) => void
  stop: () => void
}

// 16:9 video constraints for a given camera.
function videoConstraints(facing: Facing): MediaTrackConstraints {
  return {
    facingMode: { ideal: facing },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 16 / 9 },
  }
}

export function usePhoneVideo(gameId: string | undefined, active: boolean): PhoneVideo {
  const [isLive, setIsLive] = useState(false)
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [incoming, setIncoming] = useState<MediaStream | null>(null)
  const [local, setLocal] = useState<MediaStream | null>(null)
  const [viewers, setViewers] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [facing, setFacing] = useState<Facing>('environment')
  const [zoom, setZoomState] = useState(1)
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)

  const me = useRef(rid())
  const chan = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localRef = useRef<MediaStream | null>(null)
  const bcastRef = useRef(false)
  const startTs = useRef(0)
  const curBc = useRef<string | null>(null) // current broadcaster id (viewer side)
  const heartbeat = useRef<number | undefined>(undefined)
  const liveTimer = useRef<number | undefined>(undefined)

  const send = useCallback((m: Sig) => {
    chan.current?.send({ type: 'broadcast', event: 'sig', payload: m })
  }, [])

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
    for (const id of [...pcs.current.keys()]) closePc(id)
    localRef.current?.getTracks().forEach((t) => t.stop())
    localRef.current = null
    setLocal(null)
    setViewers(0)
  }, [closePc])

  // Broadcaster → create a sending peer connection for a viewer and offer.
  const offerTo = useCallback(
    async (subId: string) => {
      if (!bcastRef.current || pcs.current.has(subId) || !localRef.current) return
      const pc = new RTCPeerConnection({ iceServers: ICE })
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
      const pc = new RTCPeerConnection({ iceServers: ICE })
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
            if (isNew) send({ kind: 'hello', from: me.current })
          }
          break
        }
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

  const goLive = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints('environment'),
        audio: true,
      })
      localRef.current = stream
      setLocal(stream)
      setFacing('environment')
      readZoom(stream.getVideoTracks()[0])
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
  }, [send, closePc, readZoom])

  // Flip front/back: grab the other camera and hot-swap the video track on every
  // peer connection (no renegotiation) plus the local preview.
  const switchCamera = useCallback(async () => {
    if (!bcastRef.current || !localRef.current) return
    const next: Facing = facing === 'environment' ? 'user' : 'environment'
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next) })
      const newTrack = fresh.getVideoTracks()[0]
      for (const pc of pcs.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) await sender.replaceTrack(newTrack)
      }
      const audio = localRef.current.getAudioTracks()
      localRef.current.getVideoTracks().forEach((t) => t.stop())
      const merged = new MediaStream([newTrack, ...audio])
      localRef.current = merged
      setLocal(merged)
      setFacing(next)
      readZoom(newTrack)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch cameras.')
    }
  }, [facing, readZoom])

  const setZoom = useCallback((z: number) => {
    const track = localRef.current?.getVideoTracks()[0]
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

  return {
    isLive,
    isBroadcasting,
    incoming,
    local,
    viewers,
    error,
    facing,
    zoom,
    zoomRange,
    goLive,
    switchCamera,
    setZoom,
    stop,
  }
}

export type BroadcastStatus = { live: boolean; viewers: number }

// Passive monitor (no media, no signaling) for the scorer: listens for the
// broadcaster's heartbeats so we can show whether a phone livestream is
// happening and healthy. Drops to offline if heartbeats stop.
export function useBroadcastStatus(gameId: string | undefined, active: boolean): BroadcastStatus {
  const [live, setLive] = useState(false)
  const [viewers, setViewers] = useState(0)
  const bc = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!gameId || !active) {
      setLive(false)
      setViewers(0)
      return
    }
    const ch = supabase.channel(videoChannelName(gameId), { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'sig' }, ({ payload }) => {
      const m = payload as Sig
      if (m?.kind === 'live') {
        bc.current = m.from
        setLive(true)
        setViewers(m.viewers ?? 0)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          setLive(false)
          setViewers(0)
        }, LIVE_TIMEOUT_MS)
      } else if (m?.kind === 'bye' && m.from === bc.current) {
        setLive(false)
        setViewers(0)
        window.clearTimeout(timer.current)
      }
    }).subscribe()
    return () => {
      window.clearTimeout(timer.current)
      supabase.removeChannel(ch)
    }
  }, [gameId, active])

  return { live, viewers }
}
