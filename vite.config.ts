import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync, statSync } from 'fs';

const __dirname = import.meta.dirname;

// Path aliases
const aliases = {
  '~shared': resolve(__dirname, 'shared'),
  '~shared/*': resolve(__dirname, 'shared/*'),
};

// 直接读取 .env 文件
function readEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  const result: Record<string, string> = {};

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      result[key] = val;
    }
  }

  return result;
}

const envVars = readEnvFile();
const anonKey = envVars['VITE_SUPABASE_ANON_KEY'] || '';
const projectRef = envVars['VITE_SUPABASE_PROJECT_REF'] || 'trteewgplkqiedonomzg';
const supabaseUrl = `https://${projectRef}.supabase.co`;
const siteBase = (envVars['VITE_SITE_BASE_URL'] || 'https://www.tryhomescope.com').replace(/\/$/, '');

if (!anonKey) {
  console.warn('[vite.config.ts] VITE_SUPABASE_ANON_KEY is empty or not found in .env!');
}

const sharedDefine = {
  __SUPABASE_ANON_KEY__: JSON.stringify(anonKey),
  __SITE_BASE_URL__: JSON.stringify(siteBase),
};

// ===== 构建后复制文件到 extension/dist =====
function copyToExtension(distDir: string, extDir: string) {
  // 确保目录存在
  if (!existsSync(extDir)) {
    mkdirSync(extDir, { recursive: true });
  }

  // 复制 manifest.json
  const manifestSrc = resolve(__dirname, 'extension', 'manifest.json');
  if (existsSync(manifestSrc)) {
    copyFileSync(manifestSrc, resolve(extDir, 'manifest.json'));
    console.log('[vite] Copied manifest.json');
  }

  // 复制扩展图标（manifest 的 icons 指向根目录 icon.png）
  const iconSrc = resolve(__dirname, 'extension', 'icon.png');
  if (existsSync(iconSrc)) {
    copyFileSync(iconSrc, resolve(extDir, 'icon.png'));
    console.log('[vite] Copied icon.png');
  }

  // 复制 background.js
  const bgSrc = resolve(__dirname, 'extension', 'background.js');
  if (existsSync(bgSrc)) {
    copyFileSync(bgSrc, resolve(extDir, 'background.js'));
    console.log('[vite] Copied background.js');
  }

  // 复制 content.js
  const contentSrc = resolve(__dirname, 'extension', 'content.js');
  if (existsSync(contentSrc)) {
    copyFileSync(contentSrc, resolve(extDir, 'content.js'));
    console.log('[vite] Copied content.js');
  }

  // 复制 sidepanel.html（内含固定路径 ./assets/sidepanel-ext.js 与 .css，由 rollup output 生成）
  const sidepanelSrc = resolve(__dirname, 'extension', 'sidepanel.html');
  if (existsSync(sidepanelSrc)) {
    copyFileSync(sidepanelSrc, resolve(extDir, 'sidepanel.html'));
    console.log('[vite] Copied sidepanel.html');
  }

  // 复制 assets 目录（Vite 构建后从 dist/assets 复制到 extension/dist/assets）
  const assetsSrc = resolve(distDir, 'assets');
  const assetsDest = resolve(extDir, 'assets');
  if (existsSync(assetsSrc)) {
    // assetsSrc 存在（Vite 构建成功），复制到目标目录
    if (!existsSync(assetsDest)) {
      mkdirSync(assetsDest, { recursive: true });
    }
    try {
      const files = readdirSync(assetsSrc);
      for (const file of files) {
        const srcFile = resolve(assetsSrc, file);
        const destFile = resolve(assetsDest, file);
        if (existsSync(srcFile) && statSync(srcFile).isFile()) {
          copyFileSync(srcFile, destFile);
        }
      }
      console.log(`[vite] Copied ${files.length} assets`);
    } catch (err) {
      console.warn(`[vite] Warning: could not read assets directory:`, err);
    }

    // 同步 sidepanel-ext.css（可能带 hash → 固定名，确保 sidepanel.html 引用有效）
    try {
      const cssFiles = readdirSync(assetsSrc).filter((f) => f.startsWith('sidepanel-ext-') && f.endsWith('.css'));
      const cssFixed = resolve(assetsDest, 'sidepanel-ext.css');
      if (cssFiles.length) {
        copyFileSync(resolve(assetsSrc, cssFiles[0]), cssFixed);
        console.log(`[vite] Synced sidepanel-ext.css`);
      }
    } catch (err) {
      console.warn(`[vite] Warning: could not sync CSS:`, err);
    }

    // 同步 sidepanel-ext.js（入口文件带 hash → 固定名）
    try {
      const jsFiles = readdirSync(assetsSrc).filter((f) => f.startsWith('sidepanel-ext-') && f.endsWith('.js'));
      const jsFixed = resolve(assetsDest, 'sidepanel-ext.js');
      if (jsFiles.length) {
        copyFileSync(resolve(assetsSrc, jsFiles[0]), jsFixed);
        console.log(`[vite] Synced sidepanel-ext.js`);
      }
    } catch (err) {
      console.warn(`[vite] Warning: could not sync JS:`, err);
    }
  } else {
    console.log(`[vite] No assets directory found (this is normal if sidepanel has no assets)`);
  }

  // After all files are copied, inject auth config into background.js and content.js
  injectAuthConfig(extDir);
}

// ===== Inject auth config into extension scripts after copy =====
function injectAuthConfig(extDir) {
  if (!existsSync(extDir)) return;
  const bgFile = resolve(extDir, 'background.js');
  const csFile = resolve(extDir, 'content.js');

  const replacements = [
    ['__SUPABASE_URL__', JSON.stringify(supabaseUrl)],
    ['__SUPABASE_ANON_KEY__', JSON.stringify(anonKey)],
    ['__MAGIC_LINK_REDIRECT__', JSON.stringify(`${siteBase}/auth/callback?from_extension=1`)],
    ['__AUTH_BRIDGE_SOURCE__', JSON.stringify('homescope-auth-bridge')],
    // __INJECTED_AT__ intentionally removed — it was unused and JSON.stringify(Date.now())
    // produced a quoted string that became an invalid JS const name ("1234" = ...)
  ];

  for (const [file, label] of [[bgFile, 'background.js'], [csFile, 'content.js']]) {
    if (!existsSync(file)) continue;
    let content = readFileSync(file, 'utf8');
    for (const [placeholder, value] of replacements) {
      content = content.replace(new RegExp(placeholder, 'g'), value);
    }
    writeFileSync(file, content, 'utf8');
    console.log(`[vite] Injected auth config into ${label}`);
  }
}

// ===== 清理目录 =====
function cleanDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 判断是否为扩展构建
const isExtensionBuild = process.env.BUILD_TARGET === 'extension';
const outDir = isExtensionBuild ? resolve(__dirname, 'extension', 'dist') : resolve(__dirname, 'dist');

export default defineConfig(({ command }) => {
  // 构建前清理
  if (command === 'build') {
    cleanDir(outDir);
  }

  const isDev = command === 'serve';

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'vite-plugin-copy-extension',
        closeBundle() {
          if (command === 'build' && isExtensionBuild) {
            copyToExtension(outDir, outDir);
          }
        },
      },
    ],
    resolve: {
      alias: aliases,
    },
    define: sharedDefine,
    server: {
      proxy: isDev ? {
        // 开发环境：代理 API 请求到本地 Vercel Functions
        // 需要在项目目录运行: npx vercel dev
        // 如果本地没有运行 vercel dev，此代理会失败（connection refused），
        // 但不会影响应用正常工作，只是 sitemap 在 dev 下不可用而已。
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/sitemap.xml': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      } : {},
    },
    build: {
      outDir,
      emptyOutDir: command === 'build',
      copyPublicDir: true, // 确保 public 目录的文件被复制到 dist
      rollupOptions: {
        input: isExtensionBuild
          ? resolve(__dirname, 'src', 'extension', 'sidepanel-ext.tsx')
          : resolve(__dirname, 'index.html'),
        ...(isExtensionBuild
          ? {
              output: {
                entryFileNames: 'assets/sidepanel-ext.js',
                chunkFileNames: 'assets/chunk-[name]-[hash].js',
                assetFileNames: (assetInfo) => {
                  if (assetInfo.names?.some((n) => n.endsWith('.css'))) {
                    return 'assets/sidepanel-ext.css';
                  }
                  return 'assets/[name][extname]';
                },
              },
            }
          : {}),
      },
    },
    base: isExtensionBuild ? './' : '/',
  };
});
