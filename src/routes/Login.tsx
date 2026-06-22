import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { BrandLogo } from '@/components/Logo'

export default function Login() {
  const { session, signIn, signUp } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? '/setup'
    return <Navigate to={from} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    const fn = mode === 'in' ? signIn : signUp
    const { error } = await fn(email, password)
    setBusy(false)
    if (error) {
      setError(error)
    } else if (mode === 'up') {
      setNotice('Account created. Check your email if confirmation is required, then sign in.')
      setMode('in')
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-cream p-6">
      <BrandLogo className="mb-6 w-56 max-w-[70vw]" />
      <div className="w-full max-w-sm border-2 border-gold bg-ink p-6">
        <p className="mb-6 text-center font-athletic uppercase tracking-[0.14em] text-muted-green">
          {mode === 'in' ? 'Operator sign in' : 'Create operator account'}
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
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-2 border-gold bg-cream px-3 py-2 font-data text-ink outline-none focus:border-cream"
            />
          </label>

          {error && <p className="font-data text-sm text-barn-red">{error}</p>}
          {notice && <p className="font-data text-sm text-gold">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 bg-gold py-3 font-display text-lg text-ink disabled:opacity-60"
          >
            {busy ? '…' : mode === 'in' ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === 'in' ? 'up' : 'in'))
            setError(null)
            setNotice(null)
          }}
          className="mt-4 w-full font-athletic uppercase tracking-wide text-sm text-muted-green underline"
        >
          {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
