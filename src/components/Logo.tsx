// Brand assets. Main crest for identity moments (login, headers); the ball mark
// (baseball + play button) for small areas (nav, favicons, chips).
export function BrandLogo({ className = '' }: { className?: string }) {
  return <img src="/logo.svg" alt="Ballpark Watch" className={className} draggable={false} />
}

export function BallMark({ className = '' }: { className?: string }) {
  return <img src="/ball.svg" alt="" aria-hidden className={className} draggable={false} />
}

// Compact horizontal lockup for app headers: ball mark + wordmark.
export function HeaderWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <BallMark className="h-8 w-8" />
      <span className="font-display text-lg leading-none tracking-tight">
        Ballpark <span className="text-gold">Watch</span>
      </span>
    </span>
  )
}
