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
const channelName = (gameId: string) => `bpw:video:${gameId}`
const HEARTBEAT_MS = 2000
const LIVE_TIMEOUT_MS = 6000

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

type Sig =
  | { kind: 'live'; from: string; ts: number }
  | { kind: 'hello'; from: string }
  | { kind: 'bye'; from: string }
  | { kind: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }

export type PhoneVideo = {
  isLive: boolean // someone (possibly us) is broadcasting
  isBroadcasting: boolean // we are the broadcaster
  incoming: MediaStream | null // the feed we're watching
  local: MediaStream | null // our own camera (when broadcasting)
  viewers: number // connected viewers (broadcaster side)
  error: string | null
  goLive: () => Promise<void>
  stop: () => void
}

export function usePhoneVideo(gameId: string | undefined, active: boolean): PhoneVideo {
  const [isLive, setIsLive] = useState(false)
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [incoming, setIncoming] = useState<MediaStream | null>(null)
  const [local, setLocal] = useState<MediaStream | null>(null)
  const [viewers, setViewers] = useState(0)
  const [error, setError] = useState<string | null>(null)

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
    const ch = supabase.channel(channelName(gameId), { config: { broadcast: { self: false } } })
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

  const goLive = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: true,
      })
      localRef.current = stream
      setLocal(stream)
      setIncoming(null)
      for (const id of [...pcs.current.keys()]) closePc(id) // drop any viewer PCs we held
      bcastRef.current = true
      setIsBroadcasting(true)
      startTs.current = Date.now()
      setIsLive(true)
      const beat = () => send({ kind: 'live', from: me.current, ts: startTs.current })
      beat()
      heartbeat.current = window.setInterval(beat, HEARTBEAT_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not access the camera.')
    }
  }, [send, closePc])

  const stop = useCallback(() => {
    send({ kind: 'bye', from: me.current })
    teardownBroadcast()
    setIsLive(false)
    send({ kind: 'hello', from: me.current }) // rejoin as a viewer if someone else picks up
  }, [send, teardownBroadcast])

  return { isLive, isBroadcasting, incoming, local, viewers, error, goLive, stop }
}
