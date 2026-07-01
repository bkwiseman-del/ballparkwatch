import { useEffect, useRef } from 'react'
import './home.css'

// Renders a marketing sub-page (Sponsors, Fields) in the SAME vintage handoff style as
// the home page: the .bb-mkt scoped CSS, the sticky-nav scrolled state, and the
// scroll-reveal on [data-section]. Content is the handoff-style HTML string.
export default function MarketingShell({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    // Sub-pages don't start over a photo the way the home hero does, so keep the nav
    // solid from the top; still toggle on scroll for consistency.
    const nav = root.querySelector<HTMLElement>('.site-nav')
    if (nav) nav.dataset.scrolled = 'true'
    const onScroll = () => {
      if (nav) nav.dataset.scrolled = String(window.scrollY > 40)
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target as HTMLElement).setAttribute('data-visible', 'true')),
      { threshold: 0.12 },
    )
    root.querySelectorAll('[data-section]').forEach((el) => obs.observe(el))

    return () => {
      window.removeEventListener('scroll', onScroll)
      obs.disconnect()
    }
  }, [html])

  // Reset scroll to top on mount (react-router keeps the previous scroll otherwise).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return <div className="bb-mkt" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}
