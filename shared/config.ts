// Shared Supabase configuration - single source of truth for both website and extension.
// Website: imported by src/lib/supabase.ts
// Extension: values injected at build time by vite.config.ts into background.js and content.js

export const SUPABASE_PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_REF || 'trteewgplkqiedonomzg'
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
export const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`
export const SITE_BASE_URL = import.meta.env.VITE_SITE_BASE_URL || 'https://www.tryhomescope.com'

// Magic Link redirect URL for extension flows (must match Supabase Auth redirect URLs)
export const EXT_MAGIC_LINK_REDIRECT = `${SITE_BASE_URL}/auth/callback?from_extension=1`

// Permitted hosts for the auth bridge (content script on these origins will forward session)
export const EXT_SITE_HOSTS: string[] = [
  'www.tryhomescope.com',
  'tryhomescope.com',
  'localhost',
  '127.0.0.1',
]

// Auth bridge postMessage source identifier (content script and AuthCallback must agree)
export const AUTH_BRIDGE_SOURCE = 'homescope-auth-bridge'

// Storage keys used by the extension (single source of truth)
export const EXT_STORAGE_KEYS = {
  HS_SESSION: 'hs_session',
  HS_USER: 'hs_user',
  HS_AUTH_MIGRATED: 'hs_auth_migrated',
} as const
