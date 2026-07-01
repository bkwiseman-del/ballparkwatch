import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PublicNav, PublicFooter } from '@/components/PublicChrome'

// Marketing page: the sponsor-funded fundraiser pitch, a LIVE preview (drop a logo and
// see it on a mock broadcast), and a link to a printable one-page sales sheet.
export default function Sponsors() {
  const [logo, setLogo] = useState<string | null>(null)
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Clean up the object URL when it changes / unmounts.
  useEffect(() => () => void (logo && URL.revokeObjectURL(logo)), [logo])

  function pick(file: File) {
    if (logo) URL.revokeObjectURL(logo)
    setLogo(URL.createObjectURL(file))
    if (!name) setName(file.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <div className="flex min-h-full flex-col bg-cream text-ink">
      <PublicNav />

      {/* Hero */}
      <section className="border-b-2 border-ink bg-ink px-5 py-16 text-cream sm:py-20">
        <div className="mx-auto max-w-4xl">
          <p className="mb-3 font-athletic text-xs font-bold uppercase tracking-[.3em] text-gold">Sponsorship</p>
          <h1 className="font-display text-4xl leading-[0.95] sm:text-6xl">
            Turn your games into a <span className="text-gold">fundraiser.</span>
          </h1>
          <p className="mt-5 max-w-xl font-data text-lg text-cream/70">
            A local business puts their name on your broadcast. They reach every family watching from
            home — and cover the whole season. <b className="text-cream">Your families pay nothing.</b>
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#preview" className="bg-gold px-6 py-3 font-display text-ink shadow-hard">
              See it on the air ▸
            </a>
            <Link to="/sponsors/sheet" className="border-2 border-cream/40 px-6 py-3 font-display text-cream">
              Get the one-page pitch
            </Link>
          </div>
        </div>
      </section>

      {/* Why it works */}
      <section className="border-b-2 border-ink px-5 py-14">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          <Card eyebrow="Families never pay" body="Bandbox is free to watch. A sponsor makes the whole broadcast free for your team — no per-family subscriptions like GameChanger." />
          <Card eyebrow="Seen all season" body="Their logo rides on every live game and replay, in front of parents, grandparents, and out-of-town family who tune in from everywhere." />
          <Card eyebrow="Boosters come out ahead" body="Sell one flat panel to a local business and it can cover your season — a booster fundraiser built into the scoreboard." />
        </div>
      </section>

      {/* Live preview */}
      <section id="preview" className="border-b-2 border-ink bg-board-green/5 px-5 py-16">
        <div className="mx-auto max-w-4xl">
          <p className="mb-2 font-athletic text-xs font-bold uppercase tracking-[.3em] text-board-green">Live preview</p>
          <h2 className="font-display text-3xl leading-tight sm:text-4xl">See your sponsor on the broadcast.</h2>
          <p className="mt-3 max-w-xl font-data text-muted-tan">
            Drop in a logo and watch it land on a real Bandbox broadcast frame. (Just a preview — nothing is
            uploaded.)
          </p>

          <div className="mt-8 grid items-start gap-6 sm:grid-cols-[1fr_1.3fr]">
            {/* Uploader */}
            <div className="border-2 border-ink bg-cream-off p-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.currentTarget.value = ''
                  if (f) pick(f)
                }}
              />
              <button onClick={() => fileRef.current?.click()} className="w-full bg-gold py-3 font-display text-ink">
                {logo ? 'Choose a different logo' : 'Upload a sponsor logo ▸'}
              </button>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Business name (optional)"
                className="mt-2 w-full appearance-none rounded-none border-2 border-ink bg-white px-3 py-2 font-data text-sm outline-none focus:border-board-green"
              />
              <p className="mt-3 font-data text-xs text-muted-tan">
                Wide/landscape logos look best. In the app, every real upload is automatically checked before
                it can appear.
              </p>
            </div>

            {/* Mock broadcast frame */}
            <WatchPreview logo={logo} name={name} />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b-2 border-ink px-5 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-6 font-display text-3xl">How it works</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            <Step n="1" head="Sell a panel" body="A coach or booster sells a season sponsorship to a local business — the printable pitch below makes it easy." />
            <Step n="2" head="Upload the logo" body="In your team's Sponsors tab, add the logo + link. It's auto-checked for a family audience before going live." />
            <Step n="3" head="It's on the air" body="Their clickable logo shows on every one of your games' watch pages — live and in replay." />
          </ol>
          <div className="mt-8">
            <Link to="/sponsors/sheet" className="inline-block bg-gold px-6 py-3 font-display text-ink shadow-hard">
              Download the one-page sales sheet ▸
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-ink px-5 py-16 text-center text-cream">
        <h2 className="mx-auto max-w-2xl font-display text-3xl sm:text-4xl">
          Free for your families. Funded by your community.
        </h2>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/" className="bg-gold px-6 py-3 font-display text-ink shadow-hard">
            Get Bandbox ▸
          </Link>
          <Link to="/fields" className="border-2 border-cream/40 px-6 py-3 font-display text-cream">
            For fields &amp; leagues
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}

function WatchPreview({ logo, name }: { logo: string | null; name: string }) {
  return (
    <div className="border-2 border-ink shadow-hard">
      {/* header */}
      <div className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 py-2">
        <span className="font-display text-sm text-cream">BANDBOX</span>
        <span className="flex items-center gap-1.5 font-athletic text-[10px] font-bold uppercase tracking-wide text-barn-red">
          <span className="h-2 w-2 animate-pulse rounded-full bg-barn-red" /> Live
        </span>
      </div>
      {/* sponsor strip */}
      <div className="flex items-center gap-3 border-b-2 border-gold/30 bg-ink/90 px-3 py-1.5">
        <span className="shrink-0 font-athletic text-[9px] font-bold uppercase tracking-[.14em] text-cream/40">
          Sponsored by
        </span>
        {logo ? (
          <img src={logo} alt={name || 'Sponsor'} className="h-7 w-auto max-w-[130px] object-contain" />
        ) : (
          <span className="border border-dashed border-cream/30 px-3 py-1 font-athletic text-[10px] uppercase tracking-wide text-cream/40">
            Your logo here
          </span>
        )}
      </div>
      {/* video + scorebug */}
      <div className="relative flex aspect-video items-center justify-center bg-night-green">
        <span className="font-athletic text-xs uppercase tracking-[.2em] text-cream/30">Your game · live</span>
        <div className="absolute bottom-2 left-2 flex items-stretch border-2 border-gold bg-ink font-display text-cream">
          <div className="flex items-center gap-1.5 px-2 py-1">
            <span className="text-xs text-cream/70">AWY</span>
            <span className="text-sm">3</span>
          </div>
          <div className="flex items-center bg-barn-red px-1.5 font-athletic text-[10px]">▲5</div>
          <div className="flex items-center gap-1.5 px-2 py-1">
            <span className="text-xs text-cream/70">HOM</span>
            <span className="text-sm">2</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Card({ eyebrow, body }: { eyebrow: string; body: string }) {
  return (
    <div className="border-2 border-ink bg-white p-5">
      <p className="mb-2 font-display text-lg text-ink">{eyebrow}</p>
      <p className="font-data text-sm leading-relaxed text-muted-tan">{body}</p>
    </div>
  )
}

function Step({ n, head, body }: { n: string; head: string; body: string }) {
  return (
    <li className="border-2 border-ink bg-white p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center bg-barn-red font-display text-cream">{n}</span>
      <p className="mt-3 font-display text-lg">{head}</p>
      <p className="mt-1 font-data text-sm leading-relaxed text-muted-tan">{body}</p>
    </li>
  )
}
