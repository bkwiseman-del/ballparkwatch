import MarketingShell from './MarketingShell'
import html from './fields.html?raw'

// Marketing page: the field / facility / league channel, in the handoff style, over a
// top-down field photo.
export default function Fields() {
  return <MarketingShell html={html} />
}
