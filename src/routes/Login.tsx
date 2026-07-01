import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { supabase } from '@/lib/supabase'
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

  // Google OAuth does a full-page redirect to Google and back; Supabase then
  // establishes the session and RequireAuth routes onward. Works for both
  // returning users and brand-new accounts (invited family who've never signed up).
  async function signInWithGoogle() {
    setError(null)
    const returnTo = (location.state as { from?: Location })?.from?.pathname ?? '/setup'
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${returnTo}` },
    })
    if (error) setError(error.message)
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-cream p-6">
      <BrandLogo className="mb-6 w-56 max-w-[70vw]" />
      <div className="w-full max-w-sm border-2 border-gold bg-ink p-6">
        <p className="mb-6 text-center font-athletic uppercase tracking-[0.14em] text-muted-green">
          Sign in
        </p>

        <button
          type="button"
          onClick={signInWithGoogle}
          className="mb-4 flex w-full items-center justify-center gap-2.5 border-2 border-gold bg-cream py-3 font-display text-ink hover:bg-white"
        >
          <GoogleG />
          Continue with Google
        </button>

        <div className="mb-4 flex items-center gap-3">
          <span className="h-px flex-1 bg-muted-green/40" />
          <span className="font-athletic text-xs uppercase tracking-wide text-muted-green">or</span>
          <span className="h-px flex-1 bg-muted-green/40" />
        </div>

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

// Google's brand 'G' mark.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}
