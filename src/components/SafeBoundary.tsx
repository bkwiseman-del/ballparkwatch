import { Component, type ReactNode } from 'react'

// Contains render-phase failures in a subtree (e.g. a video SDK that throws) so they degrade to a
// fallback instead of blanking the whole page. NOTE: React error boundaries only catch errors
// thrown during render/lifecycle — async failures (Web Worker/effect callbacks) still need their
// own try/catch at the source. This is the safety net, not the only guard.
export class SafeBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error('[SafeBoundary] contained a subtree error:', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
