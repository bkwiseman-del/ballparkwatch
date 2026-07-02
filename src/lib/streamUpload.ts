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
      return !error
    },
  }
}
