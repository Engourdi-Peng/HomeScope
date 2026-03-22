/**
 * 构建 Chrome 扩展 background（注入 .env 中的 Supabase 配置）
 * 用法: npm run build:extension
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync('npx', ['vite', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, BUILD_TARGET: 'extension' },
  shell: true,
})

process.exit(result.status ?? 1)
