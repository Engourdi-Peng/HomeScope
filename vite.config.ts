import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { readFileSync, existsSync } from 'fs'

// Path aliases
const aliases = {
  '~shared': resolve(__dirname, 'shared'),
  '~shared/*': resolve(__dirname, 'shared/*'),
}

// 直接读取 .env 文件（兼容 Vite 7 loadEnv 不稳定的情况）
function readEnvFile() {
  const envPath = resolve(process.cwd(), '.env')
  const result: Record<string, string> = {}

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx < 0) continue
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim()
      result[key] = val
    }
  }

  return result
}

const envVars = readEnvFile()
const anonKey    = envVars['VITE_SUPABASE_ANON_KEY']    || ''
const projectRef = envVars['VITE_SUPABASE_PROJECT_REF'] || 'trteewgplkqiedonomzg'
const siteBase   = (envVars['VITE_SITE_BASE_URL'] || 'https://www.tryhomescope.com').replace(/\/$/, '')
const magicLinkWebRedirect = `${siteBase}/auth/callback?from_extension=1`

if (!anonKey) {
  console.warn('[vite.config.ts] VITE_SUPABASE_ANON_KEY is empty or not found in .env!')
  console.warn('[vite.config.ts] Extension will send empty apikey and get 401.')
  console.warn('[vite.config.ts] Please set VITE_SUPABASE_ANON_KEY in your .env file.')
} else {
  console.log('[vite.config.ts] Loaded apikey prefix:', anonKey.slice(0, 10) + '...')
}
console.log('[vite.config.ts] Extension magic link redirect (HTTPS):', magicLinkWebRedirect)

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: aliases,
  },

  // 扩展构建：注入真实的 Supabase 配置到 background.js
  define: {
    __SUPABASE_ANON_KEY__:       JSON.stringify(anonKey),
    __SUPABASE_PROJECT_REF__:    JSON.stringify(projectRef),
    __MAGIC_LINK_WEB_REDIRECT__: JSON.stringify(magicLinkWebRedirect),
  },

  build: command === 'build' && process.env.BUILD_TARGET === 'extension'
    ? {
        lib: {
          entry: resolve(__dirname, 'extension/background.js'),
          formats: ['iife'],
          name: 'HomeScopeBackground',
          fileName: () => 'background.js',
        },
        outDir: resolve(__dirname, 'extension/dist'),
        emptyOutDir: true,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : undefined,
}))
