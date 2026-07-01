import MarketingShell from './MarketingShell'
import html from './sponsors.html?raw'

// Marketing page: the sponsor-funded fundraiser, in the handoff style. The broadcast
// mockup carries a made-up sponsor ("Greenfield Hardware") on the board — no uploader.
export default function Sponsors() {
  return <MarketingShell html={html} />
}
