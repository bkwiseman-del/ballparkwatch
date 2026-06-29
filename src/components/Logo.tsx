// Brand assets. Horizontal "BANDBOX LIVE" lockups — a navy-text version for light
// backgrounds and a cream-text version for the dark (ink) app headers. The ball
// mark is for small areas (chips, fallbacks).
export function BrandLogo({ className = '' }: { className?: string }) {
  // Used on the cream login screen → navy-text lockup.
  return <img src="/wordmark-on-light.png" alt="Bandbox" className={className} draggable={false} />
}

export function BallMark({ className = '' }: { className?: string }) {
  return <img src="/ball.png" alt="" aria-hidden className={className} draggable={false} />
}

// Compact horizontal lockup for app headers (dark ink background) → cream-text lockup.
export function HeaderWordmark({ className = '' }: { className?: string }) {
  return (
    <img
      src="/wordmark-on-dark.png"
      alt="Bandbox"
      className={`h-7 w-auto ${className}`}
      draggable={false}
    />
  )
}
