import { supabase } from './supabase'
import type { Handedness } from './types'

// One scanned player row, pre-confirmation. Everything is editable in the UI
// before it touches the database — the scan is a draft, never an auto-commit.
export type ScannedPlayer = {
  name: string
  number: string
  position: string
  bats: '' | Handedness
}

// Shrink a phone photo / screenshot to a reasonable size before sending it to
// the vision model: faster upload, lower cost, well within Claude's image
// limits. Re-encodes to JPEG regardless of source format.
async function fileToScaledJpeg(
  file: File,
  maxEdge = 1600,
  quality = 0.85,
): Promise<{ image_base64: string; media_type: string }> {
  const bitmap = await loadImage(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process this image.')
  ctx.drawImage(bitmap, 0, 0, w, h)

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return { image_base64: dataUrl.split(',')[1], media_type: 'image/jpeg' }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    img.src = url
  })
}

// Upload an image of a lineup and get back the players Claude could read.
// Throws with a human-readable message on any failure.
export async function scanLineupImage(file: File): Promise<ScannedPlayer[]> {
  const payload = await fileToScaledJpeg(file)
  const { data, error } = await supabase.functions.invoke('scan-lineup', {
    body: payload,
  })

  if (error) {
    // Edge function returned non-2xx — surface its JSON message if we can.
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json()
        if (body?.error) msg = body.error
      } catch {
        /* keep generic message */
      }
    }
    throw new Error(msg || 'Lineup scan failed.')
  }

  const players = (data?.players ?? []) as ScannedPlayer[]
  if (players.length === 0) throw new Error('No players were found in that image.')
  return players.map((p) => ({
    name: p.name ?? '',
    number: p.number ?? '',
    position: p.position ?? '',
    bats: p.bats === 'L' || p.bats === 'R' || p.bats === 'S' ? p.bats : '',
  }))
}
