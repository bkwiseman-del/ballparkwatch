// Viewer audio on the Web Audio API. HTML <audio> played outside a tap is
// blocked on iOS; an AudioContext unlocked by the tap can play buffers anytime,
// so FX, crowd ambience, and TTS commentary all play reliably. Sound FX play
// IMMEDIATELY (synced to the play); only the spoken commentary is queued.

const FX_FILES: Record<string, string> = {
  pitch: '/sfx/pitch.m4a',
  hit: '/sfx/hit.m4a',
  catch: '/sfx/catch.m4a',
  foul: '/sfx/foul.m4a',
  slide: '/sfx/slide.m4a',
  cheer: '/sfx/cheer.m4a',
  organ: '/sfx/organ.m4a', // inning-intro stinger (played via the voice queue)
}
const ORGAN_CUE = '@organ' // queue sentinel: play the organ stinger, not a TTS url
const CROWD_FILE = '/sfx/crowd.m4a'
const CROWD_BASE = 0.34 // ambient bed; clearly audible but under commentary/FX
const FX_VOLUME = 0.7
const CHEER_VOLUME = 0.8

class AudioManager {
  private ctx: AudioContext | null = null
  private fx: Record<string, AudioBuffer> = {}
  private crowdBuffer: AudioBuffer | null = null
  private crowdSource: AudioBufferSourceNode | null = null
  private crowdGain: GainNode | null = null
  private enabled = false
  private crowdOn = false
  private queue: string[] = [] // voice clip URLs only — FX play immediately
  private playing = false
  private voiceCache = new Map<string, AudioBuffer>()
  // Stadium reverb bus for the announcer voice (big-PA echo).
  private verbInput: AudioNode | null = null

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
        const b = bufs[i]
        // Strip leading silence so every FX starts at its attack. The source clips
        // have wildly different lead-ins (pitch ~0.56s, slide ~1.06s, catch ~0s);
        // without this the staggered starts in playFx don't line up — e.g. pitch's
        // pop would land on top of catch. No trailing content is cut.
        if (b) this.fx[k] = this.trimLead(b)
      })
      this.crowdBuffer = await this.load(CROWD_FILE)
      this.buildReverb()
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
    this.verbInput = null
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

  // Build the announcer's stadium reverb: a short pre-delay into a synthesized
  // convolution tail, mixed in as a wet send. The voice still plays dry to the
  // destination too — this just adds the big-room echo around it.
  private buildReverb() {
    if (!this.ctx) return
    const pre = this.ctx.createDelay(0.2)
    pre.delayTime.value = 0.045 // a touch of pre-delay reads as "big space"
    const conv = this.ctx.createConvolver()
    conv.buffer = this.makeImpulse(2.6, 2.4)
    const wet = this.ctx.createGain()
    wet.gain.value = 0.3 // subtle — present, not cavernous
    pre.connect(conv).connect(wet).connect(this.ctx.destination)
    this.verbInput = pre
  }

  // Exponentially-decaying stereo noise — a cheap, natural-sounding room impulse.
  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.floor(seconds * ctx.sampleRate)
    const imp = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = imp.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
      }
    }
    return imp
  }

  // Drop leading near-silence so a clip starts at its attack (keeps a tiny 5ms
  // pre-roll). Returns the original buffer if it's effectively silent.
  private trimLead(buf: AudioBuffer): AudioBuffer {
    if (!this.ctx) return buf
    const threshold = 0.03
    const n = buf.length
    let start = n
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < n; i++) {
        if (Math.abs(d[i]) > threshold) {
          if (i < start) start = i
          break
        }
      }
    }
    if (start >= n) return buf // all silence — leave it
    start = Math.max(0, start - Math.floor(0.005 * buf.sampleRate))
    if (start <= 0) return buf
    const out = this.ctx.createBuffer(buf.numberOfChannels, n - start, buf.sampleRate)
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      out.getChannelData(ch).set(buf.getChannelData(ch).subarray(start))
    }
    return out
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

  // Play a sound-FX sequence IMMEDIATELY (synced to the live action). Each step
  // is a set of sounds layered together (e.g. ['hit','cheer']); steps are
  // staggered one after another (e.g. pitch, then the crack + cheer).
  playFx(steps: string[][]) {
    if (!this.enabled || !this.ctx) return
    const STEP_GAP = 0.5 // seconds between step attacks (pitch → catch → …)
    let when = this.ctx.currentTime
    for (const layers of steps) {
      for (const name of layers) {
        const buf = this.fx[name]
        if (!buf) continue
        const src = this.ctx.createBufferSource()
        src.buffer = buf
        const g = this.ctx.createGain()
        g.gain.value = name === 'cheer' ? CHEER_VOLUME : FX_VOLUME
        src.connect(g).connect(this.ctx.destination)
        src.start(when) // full buffer — nothing is cut, so every FX is audible
      }
      when += STEP_GAP // next step's attack lands a beat later, so they read in sequence
    }
  }

  enqueueVoice(url: string) {
    if (!this.enabled) return
    this.queue.push(url)
    if (this.queue.length > 8) this.queue.splice(0, this.queue.length - 8)
    void this.pump()
  }

  // Play the organ stinger at the top of an inning. Goes through the voice queue
  // so it finishes BEFORE the inning's commentary (which queues behind it).
  enqueueOrgan() {
    if (!this.enabled) return
    this.queue.push(ORGAN_CUE)
    void this.pump()
  }

  private async pump() {
    if (this.playing || !this.enabled || !this.ctx) return
    const url = this.queue.shift()
    if (!url) return
    this.playing = true
    try {
      if (url === ORGAN_CUE) {
        await this.playAndWait(this.fx['organ'] ?? null, 0.7)
      } else {
        let buf = this.voiceCache.get(url)
        if (!buf) {
          const loaded = await this.load(url)
          if (loaded) {
            buf = loaded
            this.voiceCache.set(url, loaded)
          }
        }
        this.rampCrowd(CROWD_BASE * 0.55)
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
      src.connect(g)
      g.connect(this.ctx.destination) // dry
      if (this.verbInput) g.connect(this.verbInput) // + stadium reverb send
      src.onended = () => resolve()
      src.start()
    })
  }
}

export const audio = new AudioManager()
