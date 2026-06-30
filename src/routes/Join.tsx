import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthProvider'
import { BrandLogo } from '@/components/Logo'

// Accept a team invite. NOT behind the beta allowlist (RequireAuth) — being invited
// is itself a grant of access; accepting makes you a team member, which the widened
// has_app_access() then recognizes. Sign-in is still required.
export default function Join() {
  const { token } = useParams()
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const ran = useRef(false)
  const [state, setState] = useState<'working' | 'done' | 'error'>('working')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (loading || !session || ran.current) return
    ran.current = true
    supabase.rpc('accept_team_invite', { p_token: token }).then(({ error }) => {
      if (error) {
        setState('error')
        setMsg(error.message)
      } else {
        setState('done')
        setTimeout(() => navigate('/setup', { replace: true }), 1200)
      }
    })
  }, [session, loading, token, navigate])

  // Must be signed in first; come back here afterward.
  if (!loading && !session) {
    return <Navigate to="/login" state={{ from: { pathname: `/join/${token}` } }} replace />
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-cream p-6 text-center">
      <BrandLogo className="mb-6 w-56 max-w-[70vw]" />
      <div className="w-full max-w-sm border-2 border-gold bg-ink p-6">
        {state === 'working' && (
          <p className="font-athletic uppercase tracking-[0.14em] text-muted-green">
            Joining the team…
          </p>
        )}
        {state === 'done' && (
          <>
            <p className="font-display text-xl text-cream">You're on the team.</p>
            <p className="mt-2 font-athletic text-sm text-muted-green">Taking you in…</p>
          </>
        )}
        {state === 'error' && (
          <>
            <p className="font-display text-lg text-barn-red">Couldn't join</p>
            <p className="mt-2 font-data text-sm text-cream">{msg}</p>
            <a href="/setup" className="mt-4 inline-block font-athletic text-sm text-gold underline">
              Go to the app →
            </a>
          </>
        )}
      </div>
    </div>
  )
}
