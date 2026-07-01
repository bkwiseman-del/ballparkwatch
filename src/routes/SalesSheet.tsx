import { useState } from 'react'
import { Link } from 'react-router-dom'

// A printable one-page pitch a coach/booster hands a local business. Editable team name,
// ask, and contact; "Print / Save as PDF" uses the browser's print-to-PDF. Print CSS
// hides the toolbar so the sheet prints clean.
export default function SalesSheet() {
  const [team, setTeam] = useState('')
  const [ask, setAsk] = useState('')
  const [contact, setContact] = useState('')

  return (
    <div className="min-h-full bg-cream/60 py-6 print:bg-white print:py-0">
      {/* Toolbar (screen only) */}
      <div className="no-print mx-auto mb-5 flex max-w-[8.5in] items-center justify-between px-4">
        <Link to="/sponsors" className="font-athletic text-sm font-semibold uppercase tracking-wide text-ink/60 hover:text-ink">
          ‹ Sponsors
        </Link>
        <button onClick={() => window.print()} className="bg-gold px-5 py-2.5 font-display text-ink shadow-hard">
          Print / Save as PDF ▸
        </button>
      </div>

      {/* The sheet */}
      <div className="mx-auto max-w-[8.5in] border-2 border-ink bg-cream p-[0.6in] text-ink shadow-hard print:border-0 print:shadow-none">
        {/* Masthead */}
        <div className="flex items-end justify-between border-b-2 border-ink pb-3">
          <div>
            <p className="font-athletic text-xs font-bold uppercase tracking-[.3em] text-gold">Team Sponsorship</p>
            <h1 className="font-display text-4xl leading-none">Put your name in the game.</h1>
          </div>
          <span className="font-display text-lg text-ink/40">Bandbox</span>
        </div>

        {/* Lede */}
        <p className="mt-4 font-data text-[15px] leading-relaxed">
          <Fill value={team} onChange={setTeam} placeholder="Our team" /> streams every game live on Bandbox —
          free for families to watch from anywhere. Your business rides on that broadcast all season: a clickable
          logo on every live game and replay, seen by the parents, grandparents, and out-of-town family tuning
          in from home.
        </p>

        {/* Two columns */}
        <div className="mt-5 grid grid-cols-2 gap-5">
          <Box title="What you get">
            <ul className="ml-4 list-disc space-y-1.5 font-data text-sm">
              <li>Your logo on the broadcast — every live game + replay, all season.</li>
              <li>A clickable link to your website from the watch page.</li>
              <li>Placement on the team's public page.</li>
              <li>A tasteful, on-brand panel — no flashing banner ads.</li>
            </ul>
          </Box>
          <Box title="Why it reaches people">
            <ul className="ml-4 list-disc space-y-1.5 font-data text-sm">
              <li>Free to watch = a far bigger audience than a paid app.</li>
              <li>Families share the link — grandparents, cousins, friends tune in.</li>
              <li>Youth sports is the most local, loyal audience there is.</li>
              <li>Your support is right there on screen, game after game.</li>
            </ul>
          </Box>
        </div>

        {/* The ask */}
        <div className="mt-5 border-2 border-ink bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display text-xl">Season sponsorship</p>
            <p className="font-display text-2xl text-barn-red">
              <Fill value={ask} onChange={setAsk} placeholder="$___ / season" />
            </p>
          </div>
          <p className="mt-1 font-data text-sm text-muted-tan">
            One flat rate covers the whole season — and helps keep it free for every family on the team.
          </p>
        </div>

        {/* Contact */}
        <div className="mt-5 flex items-end justify-between border-t-2 border-ink pt-3">
          <div>
            <p className="font-athletic text-[11px] font-bold uppercase tracking-[.2em] text-muted-tan">Contact</p>
            <p className="font-data text-sm">
              <Fill value={contact} onChange={setContact} placeholder="Name · phone · email" wide />
            </p>
          </div>
          <p className="text-right font-athletic text-[11px] uppercase tracking-wide text-ink/40">
            Powered by Bandbox
            <br />
            bandbox.tv
          </p>
        </div>
      </div>
    </div>
  )
}

// An inline fill-in blank that prints its typed value cleanly.
function Fill({
  value,
  onChange,
  placeholder,
  wide,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  wide?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`border-b-2 border-dashed border-ink/40 bg-transparent px-1 outline-none placeholder:text-ink/30 focus:border-board-green print:border-none print:placeholder:text-transparent ${
        wide ? 'w-72 max-w-full' : 'w-40'
      }`}
    />
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-ink bg-white p-4">
      <p className="mb-2 font-display text-lg">{title}</p>
      {children}
    </div>
  )
}
