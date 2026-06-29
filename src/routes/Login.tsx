import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { BrandLogo } from '@/components/Logo'

// Sign-in only — Bandbox is in private beta. New accounts can't be created here; access
// is granted via the bpw.app_access allowlist (see RequireAuth). Public visitors are
// pointed at the waitlist on the marketing page.
export default function Login() {
  const { session, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Paint the body cream so iOS doesn't show the dark night-green default in the
  // safe-area strips (the home-indicator area) below the cream login screen.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F4ECD8'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  if (session) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? '/setup'
    return <Navigate to={from} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) setError(error)
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-cream p-6">
      <BrandLogo className="mb-6 w-56 max-w-[70vw]" />
      <div className="w-full max-w-sm border-2 border-gold bg-ink p-6">
        <p className="mb-6 text-center font-athletic uppercase tracking-[0.14em] text-muted-green">
          Operator sign in
        </p>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 font-athletic uppercase tracking-wide text-sm text-muted-green">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-2 border-gold bg-cream px-3 py-2 font-data text-ink outline-none focus:border-cream"
            />
          </label>
          <label className="flex flex-col gap-1 font-athletic uppercase tracking-wide text-sm text-muted-green">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-2 border-gold bg-cream px-3 py-2 font-data text-ink outline-none focus:border-cream"
            />
          </label>

          {error && <p className="font-data text-sm text-barn-red">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 bg-gold py-3 font-display text-lg text-ink disabled:opacity-60"
          >
            {busy ? '…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-5 text-center font-athletic text-sm tracking-wide text-muted-green">
          Bandbox is in private beta.{' '}
          <a href="/" className="text-gold underline">
            Join the waitlist →
          </a>
        </p>
      </div>
    </div>
  )
}
