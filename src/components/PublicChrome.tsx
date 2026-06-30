import { Link } from 'react-router-dom'
import { HeaderWordmark } from '@/components/Logo'

// Shared chrome for public, content-style pages (team page, etc.) — NOT the immersive
// viewer. Dark ink bar with the cream-on-dark wordmark + a way back into Bandbox.
export function PublicNav() {
  return (
    <header className="bg-ink">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <Link to="/" aria-label="Bandbox home">
          <HeaderWordmark />
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          <a
            href="/#pricing"
            className="hidden font-athletic text-sm font-semibold uppercase tracking-wide text-cream/70 hover:text-gold sm:inline"
          >
            Pricing
          </a>
          <Link
            to="/login"
            className="hidden font-athletic text-sm font-semibold uppercase tracking-wide text-cream/70 hover:text-gold sm:inline"
          >
            Sign in
          </Link>
          <Link to="/" className="bg-gold px-4 py-2 font-display text-sm text-ink">
            Get Bandbox ▸
          </Link>
        </div>
      </nav>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="mt-auto bg-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col items-start gap-2">
          <HeaderWordmark />
          <p className="font-data text-xs text-cream/40">Live baseball &amp; softball for youth leagues. Free to watch.</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <a href="/#pricing" className="font-athletic text-xs font-semibold uppercase tracking-wide text-cream/60 hover:text-gold">
            Pricing
          </a>
          <Link to="/login" className="font-athletic text-xs font-semibold uppercase tracking-wide text-cream/60 hover:text-gold">
            Sign in
          </Link>
          <Link to="/" className="font-athletic text-xs font-semibold uppercase tracking-wide text-cream/60 hover:text-gold">
            Bandbox
          </Link>
        </div>
      </div>
      <div className="border-t border-cream/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="font-athletic text-[11px] uppercase tracking-wide text-cream/25">© 2026 Bandbox Live</span>
          <span className="font-athletic text-[11px] uppercase tracking-wide text-cream/25">bandbox.tv</span>
        </div>
      </div>
    </footer>
  )
}
