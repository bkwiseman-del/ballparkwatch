// WHIP/WHEP WebRTC helpers for the Cloudflare Stream path.
//
// WHIP = publish (broadcaster → Stream); WHEP = play (Stream → viewer). Both are the
// same tiny handshake: create an offer, wait for ICE to gather, POST the SDP to the
// endpoint, apply the SDP answer. Non-trickle (POST the full offer) — simplest and
// robust on flaky phone networks.
//
// NOTE: these talk to Cloudflare Stream and need a live Stream account to test end to
// end; the shapes follow the WHIP (RFC 9725) / WHEP drafts Cloudflare implements.

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
  if (!res.ok) throw new Error(`WebRTC exchange failed (${res.status})`)
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
