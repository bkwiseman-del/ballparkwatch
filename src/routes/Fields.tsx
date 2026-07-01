import { Link } from 'react-router-dom'
import { PublicNav, PublicFooter } from '@/components/PublicChrome'

// Marketing page: the field / facility / league channel — asset-light, crowd-sourced
// cameras, sponsor-funded. (Post-v1 pilot; the page sets up the pitch + a way in.)
export default function Fields() {
  return (
    <div className="flex min-h-full flex-col bg-cream text-ink">
      <PublicNav />

      {/* Hero */}
      <section className="border-b-2 border-ink bg-ink px-5 py-16 text-cream sm:py-20">
        <div className="mx-auto max-w-4xl">
          <p className="mb-3 font-athletic text-xs font-bold uppercase tracking-[.3em] text-gold">For fields &amp; leagues</p>
          <h1 className="font-display text-4xl leading-[0.95] sm:text-6xl">
            Every field. Every game. <span className="text-gold">Broadcast.</span>
          </h1>
          <p className="mt-5 max-w-xl font-data text-lg text-cream/70">
            Run a field, a tournament, or a league? Put a QR code on the fence and the crowd's phones become the
            cameras. Every game is broadcastable and sponsor-funded — <b className="text-cream">no hardware to
            install, and your families pay nothing.</b>
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="mailto:hello@bandbox.tv?subject=Bandbox%20for%20our%20field" className="bg-gold px-6 py-3 font-display text-ink shadow-hard">
              Bring Bandbox to your field ▸
            </a>
            <Link to="/sponsors" className="border-2 border-cream/40 px-6 py-3 font-display text-cream">
              How sponsorship works
            </Link>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="border-b-2 border-ink px-5 py-14">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          <Card head="No hardware, no install" body="No fixed cameras to buy or mount. The phones already at the field do the filming — you're broadcasting the day you put up the QR sign." />
          <Card head="Multi-angle by the crowd" body="Any parent can scan and add their angle. More phones = more views of the same game, switchable in the viewer — coverage a single fixed cam can't match." />
          <Card head="Sponsor-funded, family-free" body="Venue and local sponsor boards cover the cost. Families never pay to watch or broadcast — the pitch to your league is 'this earns your boosters money and costs your families nothing.'" />
          <Card head="Kid-safe by default" body="Names shown as first-name + last-initial to the public, coarsened live location for strangers, a one-tap kill switch, and consent built into going public." />
        </div>
      </section>

      {/* How it works */}
      <section className="border-b-2 border-ink bg-board-green/5 px-5 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-6 font-display text-3xl">How it works</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            <Step n="1" head="We enable your field" body="Your field gets a QR sign on the fence and a facility account — sponsor boards, privacy policy, and settings flow down to every game automatically." />
            <Step n="2" head="The crowd films" body="A parent scans the QR, picks a side, and films. Every extra phone adds an angle; a fixed cam can anchor it if you want a guaranteed feed." />
            <Step n="3" head="Every game streams" body="Games broadcast free with a live scorebug and AI commentary; the venue + sponsors cover it. Replays are kept for the teams that want them." />
          </ol>
        </div>
      </section>

      {/* Business case */}
      <section className="bg-ink px-5 py-16 text-center text-cream">
        <blockquote className="mx-auto max-w-2xl font-display text-2xl leading-snug sm:text-3xl">
          “Put this on all our fields.”
        </blockquote>
        <p className="mx-auto mt-3 max-w-xl font-data text-cream/60">
          Distant families actually tuned in, a sponsor's name was on the board, and it cost the league nothing.
          That's the whole business case.
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <a href="mailto:hello@bandbox.tv?subject=Bandbox%20for%20our%20field" className="bg-gold px-6 py-3 font-display text-ink shadow-hard">
            Talk to us ▸
          </a>
          <Link to="/" className="border-2 border-cream/40 px-6 py-3 font-display text-cream">
            Get Bandbox
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}

function Card({ head, body }: { head: string; body: string }) {
  return (
    <div className="border-2 border-ink bg-white p-5">
      <p className="mb-2 font-display text-lg text-ink">{head}</p>
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
