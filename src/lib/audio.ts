// Viewer audio on the Web Audio API. HTML <audio> played outside a tap is
// blocked on iOS; an AudioContext unlocked by the tap can play buffers anytime,
// so FX, crowd ambience, and TTS commentary all play reliably. FX and voice run
// through one sequential queue (pitch → catch → voice), so nothing overlaps.

const FX_FILES: Record<string, string> = {
  pitch: '/sfx/pitch.m4a',
  hit: '/sfx/hit.m4a',
  catch: '/sfx/catch.m4a',
  foul: '/sfx/foul.m4a',
  slide: '/sfx/slide.m4a',
}
const CROWD_FILE = '/sfx/crowd.m4a'
const CROWD_BASE = 0.18
const FX_VOLUME = 0.7

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

type QueueItem = { kind: 'fx'; name: string } | { kind: 'voice'; url: string }

class AudioManager {
  private ctx: AudioContext | null = null
  private fx: Record<string, AudioBuffer> = {}
  private crowdBuffer: AudioBuffer | null = null
  private crowdSource: AudioBufferSourceNode | null = null
  private crowdGain: GainNode | null = null
  private enabled = false
  private crowdOn = false
  private queue: QueueItem[] = []
  private playing = false
  private voiceCache = new Map<string, AudioBuffer>()

  isEnabled() {
    return this.enabled
  }

  // Call from a user gesture (tap). Unlocks the context and preloads buffers.
  async enable() {
    if (this.enabled) return
    try {
      const Ctx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx()
      await this.ctx.resume()
      const entries = Object.entries(FX_FILES)
      const bufs = await Promise.all(entries.map(([, url]) => this.load(url)))
      entries.forEach(([k], i) => {
        if (bufs[i]) this.fx[k] = bufs[i] as AudioBuffer
      })
      this.crowdBuffer = await this.load(CROWD_FILE)
      this.enabled = true
    } catch {
      this.enabled = false
    }
  }

  disable() {
    this.enabled = false
    this.crowdOn = false
    this.queue = []
    this.playing = false
    this.stopCrowd()
    this.ctx?.close().catch(() => {})
    this.ctx = null
    this.fx = {}
    this.crowdBuffer = null
    this.voiceCache.clear()
  }

  private async load(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null
    try {
      const arr = await (await fetch(url)).arrayBuffer()
      return await this.ctx.decodeAudioData(arr)
    } catch {
      return null
    }
  }

  // Crowd ambience loop — on for no-video games, off when live video is present.
  setCrowd(on: boolean) {
    this.crowdOn = on
    if (!this.enabled || !this.ctx || !this.crowdBuffer) return
    if (on && !this.crowdSource) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.crowdBuffer
      src.loop = true
      const g = this.ctx.createGain()
      g.gain.value = CROWD_BASE
      src.connect(g).connect(this.ctx.destination)
      src.start()
      this.crowdSource = src
      this.crowdGain = g
    } else if (!on) {
      this.stopCrowd()
    }
  }

  private stopCrowd() {
    try {
      this.crowdSource?.stop()
    } catch {
      /* already stopped */
    }
    this.crowdSource = null
    this.crowdGain = null
  }

  private rampCrowd(to: number, time = 0.15) {
    if (this.crowdGain && this.ctx) this.crowdGain.gain.setTargetAtTime(to, this.ctx.currentTime, time)
  }

  // Briefly swell the crowd for a big moment (only when ambience is playing).
  swellCrowd() {
    if (!this.crowdOn || !this.crowdGain || !this.ctx) return
    this.crowdGain.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.1)
    this.crowdGain.gain.setTargetAtTime(CROWD_BASE, this.ctx.currentTime + 3, 0.6)
  }

  enqueueFx(name: string) {
    if (!this.enabled) return
    this.queue.push({ kind: 'fx', name })
    this.cap()
    void this.pump()
  }

  enqueueVoice(url: string) {
    if (!this.enabled) return
    this.queue.push({ kind: 'voice', url })
    this.cap()
    void this.pump()
  }

  private cap() {
    if (this.queue.length > 10) this.queue.splice(0, this.queue.length - 10)
  }

  private async pump() {
    if (this.playing || !this.enabled || !this.ctx) return
    const item = this.queue.shift()
    if (!item) return
    this.playing = true
    try {
      if (item.kind === 'fx') {
        await this.playAndWait(this.fx[item.name] ?? null, FX_VOLUME)
      } else {
        let buf = this.voiceCache.get(item.url)
        if (!buf) {
          const loaded = await this.load(item.url)
          if (loaded) {
            buf = loaded
            this.voiceCache.set(item.url, loaded)
          }
        }
        this.rampCrowd(CROWD_BASE * 0.3)
        await this.playAndWait(buf ?? null, 1)
        this.rampCrowd(CROWD_BASE)
      }
    } catch {
      /* skip */
    }
    this.playing = false
    void this.pump()
  }

  private playAndWait(buf: AudioBuffer | null, gain: number): Promise<void> {
    return new Promise((resolve) => {
      if (!buf || !this.ctx) return resolve()
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const g = this.ctx.createGain()
      g.gain.value = gain
      src.connect(g).connect(this.ctx.destination)
      src.onended = () => resolve()
      src.start()
    })
  }
}

export const audio = new AudioManager()
