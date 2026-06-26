// Viewer audio: looping crowd ambience, one-shot sound FX, and AI voice
// commentary playback. Browsers block autoplay, so nothing plays until enable()
// is called from a user gesture (the viewer's Sound toggle).

const FX_FILES: Record<string, string> = {
  pitch: '/sfx/pitch.m4a',
  hit: '/sfx/hit.m4a',
  catch: '/sfx/catch.m4a',
  foul: '/sfx/foul.m4a',
  slide: '/sfx/slide.m4a',
}
const CROWD_FILE = '/sfx/crowd.m4a'
const CROWD_BASE = 0.18 // resting ambience volume (sits below commentary + FX)
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
  private crowdOn = false
  private queue: string[] = []
  private playing = false

  isEnabled() {
    return this.enabled
  }

  // Must be called from a user gesture (tap) to satisfy autoplay policies.
  // Preloads FX and the crowd loop, but does NOT start the crowd — that's
  // controlled by setCrowd() (we skip ambience when there's live video).
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
  }

  // Loop the crowd ambience (no-video games) or stop it (live video provides the
  // ambience itself).
  setCrowd(on: boolean) {
    this.crowdOn = on
    if (!this.enabled || !this.crowd) return
    if (on) this.crowd.play().catch(() => {})
    else this.crowd.pause()
  }

  disable() {
    this.enabled = false
    this.crowdOn = false
    this.queue = []
    this.playing = false
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

  // Briefly raise the crowd for a big moment (only when ambience is playing).
  swellCrowd() {
    if (!this.enabled || !this.crowd || !this.crowdOn) return
    const c = this.crowd
    c.volume = 0.55
    window.setTimeout(() => {
      if (this.crowd === c && this.crowdOn) c.volume = CROWD_BASE
    }, 4000)
  }

  // Queue a TTS clip; clips play one after another so they never overlap. If we
  // fall well behind live, stale clips are dropped.
  enqueueCommentary(url: string) {
    if (!this.enabled) return
    this.queue.push(url)
    if (this.queue.length > 5) this.queue.splice(0, this.queue.length - 5)
    this.pump()
  }

  private pump() {
    if (this.playing || !this.enabled) return
    const url = this.queue.shift()
    if (!url) return
    this.playing = true
    const a = new Audio(url)
    this.commentary = a
    // Duck the crowd under the voice when ambience is on; with live video there's
    // no crowd, so it simply overlays the video audio.
    const c = this.crowdOn ? this.crowd : null
    if (c) c.volume = CROWD_BASE * 0.35
    const done = () => {
      if (c && this.crowd === c && this.crowdOn) c.volume = CROWD_BASE
      this.playing = false
      this.pump()
    }
    a.onended = done
    a.onerror = done
    a.play().catch(done)
  }
}

export const audio = new AudioManager()
