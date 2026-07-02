// WHIP/WHEP WebRTC helpers for the Cloudflare Stream path.
//
// WHIP = publish (broadcaster → Stream); WHEP = play (Stream → viewer). Both are the
// same tiny handshake: create an offer, wait for ICE to gather, POST the SDP to the
// endpoint, apply the SDP answer. Non-trickle (POST the full offer) — simplest and
// robust on flaky phone networks.
//
// NOTE: these talk to Cloudflare Stream and need a live Stream account to test end to
// end; the shapes follow the WHIP (RFC 9725) / WHEP drafts Cloudflare implements.

import { attachHls } from './hls'

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

export type RtcSession = {
  pc: RTCPeerConnection
  close: () => void
}

// Resolve the Location header (the WHIP/WHEP resource, used to DELETE on stop) against
// the endpoint URL — servers may return it relative.
function resourceUrl(endpoint: string, location: string | null): string | null {
  if (!location) return null
  try {
    return new URL(location, endpoint).toString()
  } catch {
    return null
  }
}

// Wait until ICE candidates are gathered so the POSTed offer is complete. Capped so a
// stuck gathering state can't hang the go-live.
function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      clearTimeout(timer)
      resolve()
    }
    const check = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

async function sdpExchange(endpoint: string, offerSdp: string): Promise<{ answer: string; resource: string | null }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[whep/whip] SDP exchange failed', res.status, detail.slice(0, 300), endpoint)
    throw new Error(`WebRTC exchange failed (${res.status})`)
  }
  const answer = await res.text()
  return { answer, resource: resourceUrl(endpoint, res.headers.get('Location')) }
}

// Publish a local MediaStream (the 16:9 canvas + audio) to a Stream WHIP URL.
export async function whipPublish(
  url: string,
  stream: MediaStream,
  onState?: (s: RTCPeerConnectionState) => void,
): Promise<RtcSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle' })
  for (const track of stream.getTracks()) pc.addTrack(track, stream)
  pc.getTransceivers().forEach((t) => (t.direction = 'sendonly'))
  if (onState) pc.onconnectionstatechange = () => onState(pc.connectionState)

  await pc.setLocalDescription(await pc.createOffer())
  await waitIceComplete(pc)
  const { answer, resource } = await sdpExchange(url, pc.localDescription!.sdp)
  await pc.setRemoteDescription({ type: 'answer', sdp: answer })

  return {
    pc,
    close: () => {
      try {
        pc.close()
      } catch {
        /* ignore */
      }
      if (resource) fetch(resource, { method: 'DELETE' }).catch(() => {})
    },
  }
}

// Play a Stream WHEP URL, delivering the remote MediaStream via onStream.
export async function whepPlay(
  url: string,
  onStream: (s: MediaStream) => void,
  onState?: (s: RTCPeerConnectionState) => void,
): Promise<RtcSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle' })
  const remote = new MediaStream()
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.ontrack = (e) => {
    remote.addTrack(e.track)
    onStream(remote)
  }
  if (onState) pc.onconnectionstatechange = () => onState(pc.connectionState)

  await pc.setLocalDescription(await pc.createOffer())
  await waitIceComplete(pc)
  const { answer, resource } = await sdpExchange(url, pc.localDescription!.sdp)
  await pc.setRemoteDescription({ type: 'answer', sdp: answer })

  return {
    pc,
    close: () => {
      try {
        pc.close()
      } catch {
        /* ignore */
      }
      if (resource) fetch(resource, { method: 'DELETE' }).catch(() => {})
    },
  }
}

// Play a Stream feed into a <video> with automatic reconnect — the live stream can drop
// (broadcaster reloads, signal blips) and resume on the SAME url, and the viewer must
// re-establish rather than sit on a dead session. Falls back to HLS if the WebRTC
// handshake can't establish at all (e.g. a browser without WHEP). Returns a stop fn.
export function attachWhep(
  video: HTMLVideoElement,
  whepUrl: string,
  opts?: { hlsUrl?: string | null; onPlaying?: (playing: boolean) => void },
): () => void {
  let session: RtcSession | null = null
  let detachHls: (() => void) | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let cancelled = false

  const scheduleRetry = (ms: number) => {
    if (cancelled) return
    clearTimeout(retry)
    retry = setTimeout(connect, ms)
  }

  function connect() {
    if (cancelled) return
    attempts++
    whepPlay(
      whepUrl,
      (stream) => {
        if (cancelled) return
        detachHls?.()
        detachHls = null
        video.srcObject = stream
        video.play().catch(() => {})
        opts?.onPlaying?.(true)
      },
      (state) => {
        if (cancelled) return
        if (state === 'connected') attempts = 0
        if (state === 'failed' || state === 'disconnected') {
          opts?.onPlaying?.(false)
          try {
            session?.close()
          } catch {
            /* ignore */
          }
          session = null
          scheduleRetry(2000) // stream likely dropped — retry the same url
        }
      },
    )
      .then((s) => {
        if (cancelled) s.close()
        else session = s
      })
      .catch(() => {
        if (cancelled) return
        opts?.onPlaying?.(false)
        // If the handshake itself won't establish, fall back to HLS after a couple tries
        // (covers browsers without WHEP); otherwise keep retrying WHEP.
        if (attempts >= 2 && opts?.hlsUrl) {
          video.srcObject = null
          detachHls = attachHls(video, opts.hlsUrl)
          video.play().catch(() => {})
          opts?.onPlaying?.(true)
        } else {
          scheduleRetry(2500)
        }
      })
  }

  connect()
  return () => {
    cancelled = true
    clearTimeout(retry)
    try {
      session?.close()
    } catch {
      /* ignore */
    }
    detachHls?.()
    video.srcObject = null
    opts?.onPlaying?.(false)
  }
}
