// Shared Supabase configuration - single source of truth for both website and extension.
// Website: imported by src/lib/supabase.ts
// Extension: values injected at build time by vite.config.ts into background.js

export const SUPABASE_PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_REF || 'trteewgplkqiedonomzg'
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
export const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`
export const SITE_BASE_URL = import.meta.env.VITE_SITE_BASE_URL || 'https://www.tryhomescope.com'
