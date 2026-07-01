import { Link } from 'react-router-dom'

// A fixed (non-editable) one-page sponsor pitch sheet a coach prints/PDFs and hands to a
// local business. Explains the deal + shows an example on a real Bandbox broadcast frame.
// Prints to a single Letter page (print CSS below forces backgrounds + one-page fit).
export default function SalesSheet() {
  return (
    <div className="min-h-full bg-ink/10 py-6 print:bg-white print:py-0">
      <style>{`
        @page { size: letter; margin: 0.45in; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Toolbar (screen only) */}
      <div className="no-print mx-auto mb-5 flex max-w-[8in] items-center justify-between px-4">
        <Link to="/sponsors" className="font-athletic text-sm font-semibold uppercase tracking-wide text-ink/60 hover:text-ink">
          ‹ Sponsors
        </Link>
        <button onClick={() => window.print()} className="bg-gold px-5 py-2.5 font-display text-ink shadow-hard">
          Print / Save as PDF ▸
        </button>
      </div>

      {/* The sheet */}
      <div className="mx-auto flex max-w-[8in] flex-col border-2 border-ink bg-cream text-ink shadow-hard print:border-0 print:shadow-none">
        {/* Masthead */}
        <div className="flex items-center justify-between bg-ink px-7 py-3.5 text-cream">
          <img src="/marketing/assets/bandbox-logo-dark.png" alt="Bandbox" className="h-7 w-auto" />
          <span className="font-athletic text-xs font-semibold uppercase tracking-[.2em] text-gold">Team Sponsorship</span>
        </div>

        <div className="px-7 py-6">
          {/* Headline */}
          <p className="font-athletic text-[11px] font-bold uppercase tracking-[.28em] text-barn-red">A booster fundraiser</p>
          <h1 className="mt-1 font-display text-[40px] leading-[0.92] text-ink">PUT YOUR NAME IN THE GAME.</h1>
          <p className="mt-3 max-w-2xl font-data text-[15px] leading-relaxed text-ink/75">
            This team streams every game live on Bandbox — free for families to watch from anywhere. Your business
            rides on that broadcast all season: a clickable logo on every live game and replay, seen by the
            parents, grandparents, and out-of-town family tuning in from home.
          </p>

          {/* Example broadcast */}
          <div className="mt-5">
            <p className="mb-2 font-athletic text-[10px] font-bold uppercase tracking-[.2em] text-muted-tan">
              Your logo, live on every broadcast
            </p>
            <div className="border-2 border-ink">
              {/* status bar */}
              <div className="flex items-center justify-between bg-night-green px-3 py-1.5">
                <span className="font-display text-xs text-cream">BANDBOX</span>
                <span className="flex items-center gap-1.5 font-athletic text-[9px] font-bold uppercase tracking-wide text-barn-red">
                  <span className="h-1.5 w-1.5 rounded-full bg-barn-red" /> Live
                </span>
              </div>
              {/* sponsor strip */}
              <div className="flex items-center gap-2.5 border-y-2 border-gold/40 bg-[#0e1a14] px-3 py-1.5">
                <span className="font-athletic text-[8px] font-bold uppercase tracking-[.16em] text-cream/40">Sponsored by</span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rotate-45 bg-gold" />
                  <span className="font-display text-[11px] text-cream">
                    GREENFIELD <span className="text-gold">HARDWARE</span>
                  </span>
                </span>
              </div>
              {/* video area + scorebug */}
              <div className="relative flex h-28 items-center justify-center bg-board-green">
                <span className="font-athletic text-[10px] uppercase tracking-[.2em] text-cream/30">Greenfield vs Oakdale · live</span>
                <div className="absolute bottom-2 left-2 flex items-stretch border-2 border-gold bg-night-green font-display text-cream">
                  <span className="flex items-center gap-1 px-2 py-0.5 text-xs">GFS <b className="text-sm">3</b></span>
                  <span className="flex items-center bg-barn-red px-1.5 font-athletic text-[10px]">▼6</span>
                  <span className="flex items-center gap-1 px-2 py-0.5 text-xs text-gold">OAK <b className="text-sm">2</b></span>
                </div>
              </div>
            </div>
            <p className="mt-1.5 font-data text-[11px] text-muted-tan">
              A clean, flat panel — tasteful and on-brand, never a flashing ad. Every logo is checked before it can appear.
            </p>
          </div>

          {/* Two columns */}
          <div className="mt-6 grid grid-cols-2 gap-5">
            <Box title="What you get">
              <Bullet>Your logo on the broadcast — every live game + replay, all season.</Bullet>
              <Bullet>A clickable link to your website from the watch page.</Bullet>
              <Bullet>Placement on the team's public page.</Bullet>
            </Box>
            <Box title="Why it reaches people">
              <Bullet>Free to watch = a far bigger audience than a paid app.</Bullet>
              <Bullet>Families share the link — grandparents, cousins, friends tune in.</Bullet>
              <Bullet>Youth sports is the most local, loyal audience there is.</Bullet>
            </Box>
          </div>
        </div>

        {/* Close bar */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t-2 border-ink bg-gold px-7 py-3.5 text-ink">
          <p className="font-display text-lg leading-tight">
            Free for families. <span className="text-barn-red">Funded by you.</span>
          </p>
          <p className="text-right font-athletic text-[11px] font-semibold uppercase tracking-wide text-ink/70">
            Talk to the coach who gave you this
            <br />
            <span className="text-ink">bandbox.tv</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-ink bg-white p-4">
      <p className="mb-2 font-display text-base text-ink">{title}</p>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  )
}
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 font-data text-[13px] leading-snug text-ink/80">
      <span className="mt-1 inline-block h-2 w-2 shrink-0 rotate-45 bg-barn-red" />
      <span>{children}</span>
    </li>
  )
}
