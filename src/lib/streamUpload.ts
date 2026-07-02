import { supabase } from '@/lib/supabase'

// Incremental part uploader for a recorder (server-side headless, or a laptop). Recorder
// chunks stream in during the game; we buffer to ~PART-sized parts, upload each as it
// fills (freeing memory), and on stop save_recording with the ordered part list. The
// viewer reassembles the parts. Auth is a broadcast grant token (same as the broadcaster).
export function createStreamUploader(opts: { gameId: string; token: string; startedAt: number; mime: string }) {
  const PART = 4 * 1024 * 1024
  const base = (opts.mime || 'video/webm').split(';')[0]
  const ext = base.includes('mp4') ? 'mp4' : 'webm'
  const dir = `recordings/${opts.gameId}/${opts.startedAt}`

  let buf: BlobPart[] = []
  let bufLen = 0
  let idx = 0
  const paths: string[] = []
  let chain: Promise<void> = Promise.resolve()
  let failed = false
  let total = 0

  async function uploadPart(path: string, body: Blob): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: sign, error: signErr } = await supabase.functions.invoke('sign-upload', {
        body: { token: opts.token, path },
      })
      if (!signErr && sign?.token) {
        const { error } = await supabase.storage
          .from('bpw-video')
          .uploadToSignedUrl(path, sign.token, body, { contentType: base })
        if (!error) return true
      }
      await new Promise((r) => setTimeout(r, 800))
    }
    return false
  }

  function flush() {
    if (bufLen === 0) return
    const blob = new Blob(buf, { type: base })
    const path = `${dir}/p-${String(idx++).padStart(4, '0')}.${ext}`
    buf = []
    bufLen = 0
    paths.push(path)
    chain = chain.then(async () => {
      if (failed) return
      if (!(await uploadPart(path, blob))) failed = true
    })
  }

  return {
    add(data: Blob | Uint8Array) {
      const size = data instanceof Blob ? data.size : data.byteLength
      if (!size) return
      buf.push(data as BlobPart)
      bufLen += size
      total += size
      if (bufLen >= PART) flush()
    },
    bytes: () => total,
    async finalize(): Promise<boolean> {
      flush()
      await chain
      if (failed || paths.length === 0) return false
      const { error } = await supabase.rpc('save_recording', {
        p_token: opts.token,
        p_path: paths[0],
        p_started_at: new Date(opts.startedAt).toISOString(),
        p_duration_ms: Date.now() - opts.startedAt,
        p_mime: base,
        p_segments: paths,
      })
      if (error) return false
      // Push the finished recording into Cloudflare Stream (unified, CDN-backed replay).
      // Best-effort: if it fails, the Supabase copy above is the replay fallback.
      try {
        await pushToCloudflare({ token: opts.token, paths, total })
      } catch (e) {
        console.error('[cf-push] failed', e instanceof Error ? e.message : e)
      }
      return true
    },
  }
}

// Transfer the recording (already staged as Supabase segments) into Cloudflare Stream via
// a direct-creator tus upload. Streams segment-by-segment, re-chunked to 256 KiB-aligned
// parts, so the headless recorder never holds the whole file in memory. On success, points
// the game's replay at the new Cloudflare VOD.
async function pushToCloudflare(opts: { token: string; paths: string[]; total: number }) {
  const init = await supabase.functions.invoke('stream-live', {
    body: { token: opts.token, action: 'upload-init', uploadLength: opts.total },
  })
  const uploadUrl = (init.data as { uploadUrl?: string } | null)?.uploadUrl
  const uid = (init.data as { uid?: string } | null)?.uid
  if (init.error || !uploadUrl || !uid) throw new Error(`tus init failed: ${init.error?.message ?? 'no url'}`)

  const CHUNK = 32 * 1024 * 1024 // 32 MiB — a multiple of 256 KiB (Cloudflare tus requirement)
  let offset = 0
  let carry: Uint8Array[] = []
  let carryLen = 0

  const merge = () => {
    const out = new Uint8Array(carryLen)
    let p = 0
    for (const c of carry) {
      out.set(c, p)
      p += c.byteLength
    }
    carry = []
    carryLen = 0
    return out
  }
  const patch = async (bytes: Uint8Array) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: new Blob([new Uint8Array(bytes)]),
      })
      if (res.ok) {
        offset += bytes.byteLength
        return
      }
      await new Promise((r) => setTimeout(r, 800))
    }
    throw new Error(`tus patch failed at offset ${offset}`)
  }

  for (const path of opts.paths) {
    const url = supabase.storage.from('bpw-video').getPublicUrl(path).data.publicUrl
    const res = await fetch(url)
    if (!res.ok) throw new Error(`segment fetch failed: ${path}`)
    carry.push(new Uint8Array(await res.arrayBuffer()))
    carryLen = carry.reduce((n, c) => n + c.byteLength, 0)
    while (carryLen >= CHUNK) {
      const buf = merge()
      await patch(buf.subarray(0, CHUNK))
      const rest = buf.subarray(CHUNK)
      if (rest.byteLength) {
        carry = [rest]
        carryLen = rest.byteLength
      }
    }
  }
  if (carryLen > 0) await patch(merge()) // final chunk — any size

  await supabase.functions.invoke('stream-live', {
    body: { token: opts.token, action: 'set-recording', recordingUid: uid },
  })
}
