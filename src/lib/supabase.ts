import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

// Ballpark Watch shares one Supabase project with the user's other apps
// (string-art, three-wise-prints). All our tables live in the dedicated `bpw`
// schema so the apps never collide. The `bpw` schema must be in the project's
// PostgREST exposed-schemas list, or queries 404 with PGRST106.
//
// NOTE: auth.users is project-wide (shared auth pool), so RLS is ownership-based
// (owner_id = auth.uid()), never "any authenticated user".
export const supabase = createClient(url, anonKey, {
  db: { schema: 'bpw' },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

// Storage paths are prefixed so we don't step on other apps' files.
export const STORAGE_ROOT = 'bpw'
