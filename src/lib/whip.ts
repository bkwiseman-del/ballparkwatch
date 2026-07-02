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

  // Cap the outbound video bitrate/framerate so the phone's encoder doesn't run flat-out
  // (heat) and so weak-signal fields don't choke. Cloudflare builds the ABR ladder
  // server-side, so we only need to send one clean 720p30 encoding.
  const vsender = pc.getSenders().find((s) => s.track?.kind === 'video')
  if (vsender) {
    const params = vsender.getParameters()
    params.encodings = [{ maxBitrate: 1_800_000, maxFramerate: 30 }]
    await vsender.setParameters(params).catch(() => {})
  }

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
  opts?: { hlsUrl?: string | null; onPlaying?: (playing: boolean) => void; onStatus?: (s: string) => void },
): () => void {
  let session: RtcSession | null = null
  let detachHls: (() => void) | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let mediaWatch: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let cancelled = false
  const status = (s: string) => opts?.onStatus?.(s)

  const scheduleRetry = (ms: number) => {
    if (cancelled) return
    clearTimeout(retry)
    retry = setTimeout(connect, ms)
  }
  const clearMediaWatch = () => {
    if (mediaWatch) clearTimeout(mediaWatch)
    mediaWatch = undefined
  }

  function connect() {
    if (cancelled) return
    attempts++
    let gotMedia = false
    status(`WHEP connecting (try ${attempts})`)

    // Watchdog for the "connected but silent" case: if the broadcaster is still spinning
    // up, Cloudflare accepts our WHEP connection but no track ever arrives (ICE is
    // 'connected', so the failed/disconnected retry never fires). Without this we'd sit on
    // "connecting…" until a manual reload. If no media lands in a few seconds, retry.
    clearMediaWatch()
    mediaWatch = setTimeout(() => {
      if (cancelled || gotMedia) return
      try {
        session?.close()
      } catch {
        /* ignore */
      }
      session = null
      // "Connected but silent": WHEP's ICE established but no track ever arrived — common
      // on networks where WebRTC media is blocked/filtered even though the handshake works.
      // After a couple of silent tries, fall back to HLS (reliable CDN delivery) instead of
      // retrying WHEP forever — otherwise the viewer sits on a black "connecting" box.
      if (attempts >= 2 && opts?.hlsUrl) {
        status('WHEP silent → HLS fallback')
        video.srcObject = null
        detachHls = attachHls(video, opts.hlsUrl, { lowLatency: true })
        video.play().catch(() => {})
        opts?.onPlaying?.(true)
      } else {
        status('WHEP connected but silent, retrying')
        scheduleRetry(500)
      }
    }, 5000)

    whepPlay(
      whepUrl,
      (stream) => {
        if (cancelled) return
        gotMedia = true
        clearMediaWatch()
        detachHls?.()
        detachHls = null
        video.srcObject = stream
        video.play().catch(() => {})
        status('WHEP playing')
        opts?.onPlaying?.(true)
      },
      (state) => {
        if (cancelled) return
        if (state === 'connected') attempts = 0
        if (state === 'failed' || state === 'disconnected') {
          status(`WHEP ${state}, reconnecting`)
          opts?.onPlaying?.(false)
          clearMediaWatch()
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
        clearMediaWatch()
        opts?.onPlaying?.(false)
        // If the handshake itself won't establish, fall back to HLS after a couple tries
        // (covers browsers without WHEP); otherwise keep retrying WHEP.
        if (attempts >= 2 && opts?.hlsUrl) {
          status('WHEP handshake failed → HLS fallback')
          video.srcObject = null
          detachHls = attachHls(video, opts.hlsUrl, { lowLatency: true })
          video.play().catch(() => {})
          opts?.onPlaying?.(true)
        } else {
          status('WHEP handshake failed, retrying')
          scheduleRetry(2500)
        }
      })
  }

  connect()
  return () => {
    cancelled = true
    clearTimeout(retry)
    clearMediaWatch()
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
