import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { supabase } from '@/lib/supabase'

// Pre-launch gate. Auth is shared across the three apps, so a valid session is NOT
// enough — the user's email must be on the Bandbox beta allowlist (bpw.app_access,
// checked via the security-definer bpw.has_app_access() RPC). Non-allowlisted users
// (including those signed in via another app) are sent to the public marketing page.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  const [access, setAccess] = useState<'checking' | 'yes' | 'no'>('checking')

  useEffect(() => {
    if (!session) {
      setAccess('checking')
      return
    }
    let cancelled = false
    setAccess('checking')
    supabase.rpc('has_app_access').then(({ data, error }) => {
      if (!cancelled) setAccess(!error && data === true ? 'yes' : 'no')
    })
    return () => {
      cancelled = true
    }
  }, [session])

  if (loading || (session && access === 'checking')) {
    return (
      <div className="flex h-full items-center justify-center font-athletic text-muted-green">
        Loading…
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (access === 'no') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
