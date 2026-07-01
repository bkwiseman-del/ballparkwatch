import { Link } from 'react-router-dom'

// The Bandbox phone mockup (still frame so it prints), sponsor on the board, wrench icon.
const PHONE_HTML = `
<div style="background:linear-gradient(155deg,#0c1520 0%,#06101b 100%);border-radius:46px;padding:12px;box-shadow:0 0 0 1px rgba(201,161,74,.22),0 20px 46px rgba(0,0,0,.45);width:300px">
  <div style="width:276px;height:598px;background:#15281b;border-radius:36px;overflow:hidden;display:flex;flex-direction:column">
    <div style="height:26px;background:#0e1a14;display:flex;align-items:center;justify-content:space-between;padding:0 20px;flex:none">
      <span style="font-family:'Saira Condensed',sans-serif;font-size:10px;font-weight:600;color:#F4ECD8">2:41</span>
      <div style="display:flex;align-items:center;gap:5px"><span style="width:6px;height:6px;border-radius:50%;background:#A6342E"></span><span style="font-family:'Saira Condensed',sans-serif;font-size:10px;font-weight:600;color:#F4ECD8">LIVE</span></div>
    </div>
    <div style="background:#0a0f0a;flex:none"><img src="/marketing/assets/broadcast-still.jpg" alt="Live game" style="width:100%;height:auto;display:block"/></div>
    <div style="display:flex;align-items:center;gap:8px;background:#0e1a14;border-bottom:2px solid rgba(201,161,74,.35);padding:6px 10px;flex:none">
      <span style="font-family:'Saira Condensed',sans-serif;font-size:8px;font-weight:600;letter-spacing:.16em;color:rgba(244,236,216,.4);text-transform:uppercase">Sponsored by</span>
      <span style="display:flex;align-items:center;gap:5px">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#C9A14A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
        <span style="font-family:'Alfa Slab One',serif;font-size:11px;color:#F4ECD8;letter-spacing:.01em">GREENFIELD <span style="color:#C9A14A">HARDWARE</span></span>
      </span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;background:#15281b;border-bottom:2px solid #C9A14A;padding:5px 10px;flex:none;font-family:'Saira Condensed',sans-serif;color:#F4ECD8">
      <span style="display:flex;align-items:baseline;gap:3px"><span style="font-size:12px;font-weight:600">GFS</span><span style="font-size:14px;font-weight:700">3</span></span>
      <span style="display:flex;align-items:baseline;gap:3px"><span style="font-size:12px;font-weight:600;color:#C9A14A">OAK</span><span style="font-size:14px;font-weight:700;color:#C9A14A">2</span></span>
      <span style="width:1px;height:13px;background:rgba(201,161,74,.3)"></span>
      <span style="font-size:13px;font-weight:700">▼6</span>
      <span style="display:flex;align-items:baseline;gap:3px"><span style="font-size:8px;color:#a9c0ad;letter-spacing:.08em">B–S</span><span style="font-size:13px;font-weight:700">2–1</span></span>
      <span style="margin-left:auto;display:flex"><svg width="18" height="18" viewBox="0 0 20 20"><rect x="13" y="7" width="6" height="6" transform="rotate(45 16 10)" fill="#C9A14A"/><rect x="7" y="1" width="6" height="6" transform="rotate(45 10 4)" fill="none" stroke="#F4ECD8" stroke-width="1"/><rect x="1" y="7" width="6" height="6" transform="rotate(45 4 10)" fill="#C9A14A"/></svg></span>
    </div>
    <div style="display:flex;background:#FAF4E6;border-bottom:2px solid #1A2A4A;flex:none">
      <div style="flex:1;border-right:1px solid rgba(26,42,74,.2);padding:6px 10px"><div style="font-family:'Saira Condensed',sans-serif;font-size:8px;font-weight:600;letter-spacing:.14em;color:#A6342E">AT BAT</div><div style="font-family:'Alfa Slab One',serif;font-size:12px;color:#1A2A4A"><span style="color:#A6342E">7</span> Ellis</div></div>
      <div style="flex:1;padding:6px 10px;text-align:right"><div style="font-family:'Saira Condensed',sans-serif;font-size:8px;font-weight:600;letter-spacing:.14em;color:#7a6f54">PITCHING</div><div style="font-family:'Alfa Slab One',serif;font-size:12px;color:#1A2A4A"><span style="color:#A6342E">21</span> Reyes</div></div>
    </div>
    <div style="flex:1;min-height:0;background:#2C5234;position:relative;overflow:hidden"><svg viewBox="18 112 304 258" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style="display:block"><path d="M170 330 L40 190 A182 182 0 0 1 300 190 Z" fill="#326139"/><line x1="170" y1="330" x2="44" y2="194" stroke="#e9ddc2" stroke-width="2.5"/><line x1="170" y1="330" x2="296" y2="194" stroke="#e9ddc2" stroke-width="2.5"/><polygon points="170,330 244,256 170,182 96,256" fill="#b07a3e"/><polygon points="170,318 232,256 170,194 108,256" fill="#2C5234"/><polygon points="170,330 244,256 170,182 96,256" fill="none" stroke="#e9ddc2" stroke-width="3"/><circle cx="170" cy="256" r="13" fill="#b07a3e"/><rect x="166" y="253" width="8" height="4" fill="#F4ECD8"/><circle cx="244" cy="256" r="12" fill="#C9A14A" stroke="#1A2A4A" stroke-width="2.5"/><circle cx="96" cy="256" r="12" fill="#C9A14A" stroke="#1A2A4A" stroke-width="2.5"/><rect x="162" y="174" width="16" height="16" transform="rotate(45 170 182)" fill="#F4ECD8" stroke="#1A2A4A" stroke-width="1.5"/><polygon points="162,326 178,326 178,333 170,340 162,333" fill="#F4ECD8" stroke="#1A2A4A" stroke-width="1.5"/><circle cx="170" cy="330" r="9" fill="#A6342E" stroke="#F4ECD8" stroke-width="1.5"/></svg></div>
  </div>
</div>`

// A FULL Letter page (8.5in × 11in) that fills top to bottom, so it prints as one clean
// page with no floating short block. Print CSS zeroes the page margin (the sheet owns its
// own 0.5in inner margins) and forces backgrounds.
export default function SalesSheet() {
  return (
    <div className="flex min-h-full justify-center bg-ink/20 py-6 print:block print:bg-white print:py-0">
      <style>{`
        @page { size: letter; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      <button
        onClick={() => window.print()}
        className="no-print fixed right-6 top-6 z-10 bg-gold px-5 py-2.5 font-display text-ink shadow-hard"
      >
        Print / Save as PDF ▸
      </button>
      <Link
        to="/sponsors"
        className="no-print fixed left-6 top-7 z-10 font-athletic text-sm font-semibold uppercase tracking-wide text-cream/80 hover:text-gold"
      >
        ‹ Sponsors
      </Link>

      {/* The sheet — exactly one Letter page */}
      <div
        className="flex flex-col bg-cream text-ink shadow-hard"
        style={{ width: '8.5in', height: '11in', padding: '0.5in' }}
      >
        {/* Masthead */}
        <div className="flex items-center justify-between border-b-2 border-ink pb-4">
          <img src="/marketing/assets/bandbox-logo-tall.png" alt="Bandbox" className="h-11 w-auto" />
          <span className="font-athletic text-sm font-semibold uppercase tracking-[.24em] text-barn-red">
            Team Sponsorship
          </span>
        </div>

        {/* Headline + lede */}
        <div className="pt-6">
          <h1 className="font-display text-[46px] leading-[0.9]">PUT YOUR NAME IN THE GAME.</h1>
          <p className="mt-4 font-data text-[16px] leading-relaxed text-ink/80">
            This team streams every game live on Bandbox, free for families to watch from anywhere. Your business
            rides on that broadcast all season: a clickable logo on every live game and replay, seen by the parents,
            grandparents, and family tuning in from home.
          </p>
        </div>

        {/* Main — fills the middle of the page */}
        <div className="grid flex-1 grid-cols-[auto_1fr] items-center gap-9 py-6">
          <div>
            <div style={{ width: 300, height: 622, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: PHONE_HTML }} />
            <p className="mt-3 text-center font-athletic text-[11px] font-bold uppercase tracking-[.14em] text-muted-tan">
              Your logo, live on every broadcast
            </p>
          </div>

          <div className="flex flex-col gap-6">
            <Box title="What you get">
              <Bullet>Your logo on the broadcast, every live game and replay, all season.</Bullet>
              <Bullet>A clickable link to your website from the watch page.</Bullet>
              <Bullet>Placement on the team's public page.</Bullet>
              <Bullet>A clean, flat panel, reviewed before it ever appears.</Bullet>
            </Box>
            <Box title="Why it reaches people">
              <Bullet>Free to watch means a far bigger audience than a paid app.</Bullet>
              <Bullet>Families share the link, so grandparents, cousins, and friends tune in.</Bullet>
              <Bullet>Youth sports is the most local, loyal audience there is.</Bullet>
            </Box>
          </div>
        </div>

        {/* Close bar */}
        <div className="mt-auto flex items-center justify-between gap-4 border-2 border-ink bg-gold px-6 py-4 text-ink">
          <p className="font-display text-2xl leading-tight">
            Free for families. <span className="text-barn-red">Funded by you.</span>
          </p>
          <p className="text-right font-athletic text-[12px] font-semibold uppercase tracking-wide text-ink/70">
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
    <div className="border-2 border-ink bg-white p-5">
      <p className="mb-3 font-display text-xl">{title}</p>
      <ul className="space-y-2.5">{children}</ul>
    </div>
  )
}
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 font-data text-[14px] leading-snug text-ink/80">
      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rotate-45 bg-barn-red" />
      <span>{children}</span>
    </li>
  )
}
