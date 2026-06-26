// Viewer audio: looping crowd ambience, one-shot sound FX, and AI voice
// commentary playback. Browsers block autoplay, so nothing plays until enable()
// is called from a user gesture (the viewer's Sound toggle).

const FX_FILES: Record<string, string> = {
  pitch: '/sfx/pitch.mp3',
  hit: '/sfx/hit.mp3',
  catch: '/sfx/catch.mp3',
  foul: '/sfx/foul.mp3',
  slide: '/sfx/slide.mp3',
}
const CROWD_FILE = '/sfx/crowd.mp3'
const CROWD_BASE = 0.22 // resting ambience volume
const FX_VOLUME = 0.7

// Map a game event type to a sound effect (or null for silence).
export function fxForEvent(eventType: string): string | null {
  switch (eventType) {
    case 'pitch_ball':
    case 'pitch_strike':
      return 'pitch'
    case 'pitch_foul':
      return 'foul'
    case 'single':
    case 'double':
    case 'triple':
    case 'home_run':
      return 'hit'
    case 'groundout':
    case 'flyout':
    case 'lineout':
      return 'catch'
    case 'stolen_base':
    case 'caught_stealing':
    case 'runner_advance':
    case 'picked_off':
      return 'slide'
    default:
      return null
  }
}

class AudioManager {
  private enabled = false
  private fx: Record<string, HTMLAudioElement> = {}
  private crowd: HTMLAudioElement | null = null
  private commentary: HTMLAudioElement | null = null

  isEnabled() {
    return this.enabled
  }

  // Must be called from a user gesture (tap) to satisfy autoplay policies.
  enable() {
    if (this.enabled) return
    this.enabled = true
    for (const [k, url] of Object.entries(FX_FILES)) {
      const a = new Audio(url)
      a.preload = 'auto'
      a.volume = FX_VOLUME
      this.fx[k] = a
    }
    this.crowd = new Audio(CROWD_FILE)
    this.crowd.loop = true
    this.crowd.volume = CROWD_BASE
    this.crowd.play().catch(() => {})
  }

  disable() {
    this.enabled = false
    this.crowd?.pause()
    this.crowd = null
    this.commentary?.pause()
    this.commentary = null
  }

  playFx(name: string) {
    if (!this.enabled) return
    const base = this.fx[name]
    if (!base) return
    // Clone so rapid events can overlap.
    const a = base.cloneNode(true) as HTMLAudioElement
    a.volume = base.volume
    a.play().catch(() => {})
  }

  // Briefly raise the crowd for a big moment (hit / run scoring).
  swellCrowd() {
    if (!this.enabled || !this.crowd) return
    const c = this.crowd
    c.volume = 0.6
    window.setTimeout(() => {
      if (this.crowd === c) c.volume = CROWD_BASE
    }, 4000)
  }

  // Play a TTS clip, ducking the crowd under the voice.
  playCommentary(url: string) {
    if (!this.enabled) return
    this.commentary?.pause()
    const a = new Audio(url)
    this.commentary = a
    const c = this.crowd
    const resting = CROWD_BASE
    if (c) c.volume = resting * 0.35
    const restore = () => {
      if (c && this.crowd === c) c.volume = resting
    }
    a.onended = restore
    a.onerror = restore
    a.play().catch(restore)
  }
}

export const audio = new AudioManager()
