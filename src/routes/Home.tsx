import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import './home.css'
// The marketing markup is the Claude Design handoff verbatim (see docs handoff zip),
// cleaned of its templating. We render it as static HTML and layer the few behaviors
// (sticky-nav state, scroll reveal, hero count-up, announcer sample, waitlist CTAs).
import homeHtml from './home.html?raw'

type Status = 'idle' | 'loading' | 'done' | 'error'

export default function Home() {
  const ref = useRef<HTMLDivElement>(null)
  // Pre-launch: every "Start Free"-style CTA opens the waitlist instead of the app.
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  const join = async () => {
    const e = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      setStatus('error')
      return
    }
    setStatus('loading')
    const { error } = await supabase.from('waitlist').insert({ email: e, source: 'marketing' })
    // 23505 = already on the list → treat as success.
    setStatus(error && error.code !== '23505' ? 'error' : 'done')
  }

  useEffect(() => {
    const root = ref.current
    if (!root) return

    // Sticky nav gets a solid background once scrolled.
    const nav = root.querySelector<HTMLElement>('.site-nav')
    const onScroll = () => {
      if (nav) nav.dataset.scrolled = String(window.scrollY > 60)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    // Reveal each section as it enters the viewport.
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            ;(e.target as HTMLElement).dataset.visible = 'true'
            obs.unobserve(e.target)
          }
        }
      },
      { threshold: 0.08 },
    )
    root.querySelectorAll('[data-section]').forEach((el) => obs.observe(el))

    // Hero scoreboard counts up 0→3 / 0→4 on load.
    const away = root.querySelector<HTMLElement>('#bbHeroAway')
    const home = root.querySelector<HTMLElement>('#bbHeroHome')
    let raf = 0
    const start = window.setTimeout(() => {
      const t0 = performance.now()
      const tick = (now: number) => {
        const p = Math.min((now - t0) / 1200, 1)
        const e = 1 - Math.pow(1 - p, 3)
        if (away) away.textContent = String(Math.round(e * 3))
        if (home) home.textContent = String(Math.round(e * 4))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, 500)

    // Every primary CTA (still pointing at /login in the markup) opens the waitlist.
    const ctas = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href="/login"]'))
    const openWaitlist = (ev: Event) => {
      ev.preventDefault()
      setStatus('idle')
      setWaitlistOpen(true)
    }
    ctas.forEach((a) => a.addEventListener('click', openWaitlist))

    // AI-announcer sample: organ + crowd → clip1 ("…Park winds up") → pitch → bat-crack →
    // crowd erupts → clip2 ("AND HE DRIVES IT…"). Plays on the user's click (gesture-allowed).
    const sampleBtn = root.querySelector<HTMLAnchorElement>('#bb-hear-sample')
    let sampleAudio: HTMLAudioElement[] = []
    const sampleTimers: number[] = []
    const stopSample = () => {
      sampleAudio.forEach((a) => { try { a.pause() } catch { /* ignore */ } })
      sampleAudio = []
      sampleTimers.forEach((t) => window.clearTimeout(t))
      sampleTimers.length = 0
    }
    const mk = (src: string, vol: number) => {
      const a = new Audio(src); a.volume = vol; sampleAudio.push(a); return a
    }
    const playSample = (ev: Event) => {
      ev.preventDefault()
      stopSample()
      const play = (a: HTMLAudioElement) => { a.play().catch(() => {}) }
      const organ = mk('/sfx/organ.m4a', 0.55)
      const crowd = mk('/sfx/crowd.m4a', 0.16); crowd.loop = true
      const clip1a = mk('/marketing/assets/announcer-1a.mp3', 1) // "Reyes steps in. Full count, two on."
      const clip1b = mk('/marketing/assets/announcer-1b.mp3', 1) // "Park winds up..."
      const pitch = mk('/sfx/pitch.m4a', 0.7)
      const hit = mk('/sfx/hit.m4a', 0.9)
      const clip2 = mk('/marketing/assets/announcer-2.mp3', 1)
      const cheer = mk('/sfx/cheer.m4a', 0.7)
      play(organ); play(crowd)
      sampleTimers.push(window.setTimeout(() => play(clip1a), 1500)) // short organ+crowd intro
      clip1a.onended = () => {
        sampleTimers.push(window.setTimeout(() => play(clip1b), 650)) // a beat before "Park winds up"
      }
      clip1b.onended = () => {
        play(pitch) // the delivery
        sampleTimers.push(window.setTimeout(() => { hit.currentTime = 0; play(hit) }, 600)) // crack a beat after the pitch
        sampleTimers.push(window.setTimeout(() => { play(cheer); crowd.volume = 0.32 }, 780)) // crowd erupts just after
        sampleTimers.push(window.setTimeout(() => play(clip2), 1100)) // the call over the reaction
      }
      clip2.onended = () => {
        sampleTimers.push(window.setTimeout(() => {
          const fade = window.setInterval(() => {
            crowd.volume = Math.max(0, crowd.volume - 0.04)
            if (crowd.volume <= 0) { window.clearInterval(fade); crowd.pause() }
          }, 80)
        }, 1200))
      }
    }
    sampleBtn?.addEventListener('click', playSample)

    return () => {
      window.removeEventListener('scroll', onScroll)
      obs.disconnect()
      window.clearTimeout(start)
      cancelAnimationFrame(raf)
      ctas.forEach((a) => a.removeEventListener('click', openWaitlist))
      sampleBtn?.removeEventListener('click', playSample)
      stopSample()
    }
  }, [])

  return (
    <>
      <div ref={ref} className="bb-mkt" dangerouslySetInnerHTML={{ __html: homeHtml }} />
      {waitlistOpen && (
        <div
          onClick={() => setWaitlistOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,14,20,.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            fontFamily: 'Archivo, sans-serif',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative', width: '100%', maxWidth: 440, background: '#15281b', border: '3px solid #C9A14A', padding: '40px 32px' }}
          >
            <button
              onClick={() => setWaitlistOpen(false)}
              aria-label="Close"
              style={{ position: 'absolute', top: 8, right: 14, background: 'none', border: 'none', color: 'rgba(244,236,216,.5)', fontSize: 26, lineHeight: 1, cursor: 'pointer' }}
            >
              ×
            </button>

            {status === 'done' ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: "'Alfa Slab One', serif", fontSize: 30, color: '#F4ECD8', lineHeight: 0.95 }}>
                  YOU’RE ON<br />THE LIST.
                </div>
                <p style={{ color: 'rgba(244,236,216,.7)', fontSize: 15, lineHeight: 1.6, margin: '16px 0 0' }}>
                  We’ll email you the moment Bandbox opens. ⚾
                </p>
              </div>
            ) : (
              <>
                <div style={{ fontFamily: "'Saira Condensed', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '.28em', color: '#a9c0ad', textTransform: 'uppercase', marginBottom: 10 }}>
                  Launching soon
                </div>
                <div style={{ fontFamily: "'Alfa Slab One', serif", fontSize: 30, color: '#F4ECD8', lineHeight: 0.95, marginBottom: 12 }}>
                  BE FIRST ON<br />THE FIELD.
                </div>
                <p style={{ color: 'rgba(244,236,216,.7)', fontSize: 15, lineHeight: 1.6, margin: '0 0 22px' }}>
                  Bandbox isn’t open to the public yet. Drop your email and we’ll let you know the
                  moment it’s ready — and remember, the family never pays to watch.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle') }}
                    onKeyDown={(e) => { if (e.key === 'Enter') join() }}
                    placeholder="you@email.com"
                    autoFocus
                    style={{
                      width: '100%', padding: '13px 14px', background: '#0e1a14',
                      border: `2px solid ${status === 'error' ? '#A6342E' : 'rgba(244,236,216,.25)'}`,
                      color: '#F4ECD8', fontFamily: 'Archivo, sans-serif', fontSize: 15, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  {status === 'error' && (
                    <span style={{ color: '#e08a84', fontSize: 13 }}>Please enter a valid email.</span>
                  )}
                  <button
                    onClick={join}
                    disabled={status === 'loading'}
                    style={{
                      padding: 14, background: '#C9A14A', color: '#1A2A4A', border: 'none',
                      fontFamily: "'Alfa Slab One', serif", fontSize: 15, letterSpacing: '.04em',
                      cursor: status === 'loading' ? 'default' : 'pointer', opacity: status === 'loading' ? 0.7 : 1,
                    }}
                  >
                    {status === 'loading' ? 'JOINING…' : 'JOIN THE WAITLIST ▸'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
