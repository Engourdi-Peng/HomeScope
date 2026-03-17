# Vercel 部署指南 - 针对澳大利亚用户

## 步骤 1: 连接 GitHub 仓库

1. 访问 [Vercel](https://vercel.com) 并使用 GitHub 账号登录
2. 点击 "Add New..." -> "Project"
3. 选择你的 `AIfangyuanzhushou` 仓库
4. 点击 "Import"

## 步骤 2: 配置项目设置

在 Vercel 项目配置页面，填写以下内容：

| 设置项 | 值 |
|--------|-----|
| **Production Branch** | **`main`**（必须用 main，不要用 gh-pages） |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |

**重要**：部署分支必须选择 **main**。若选成 **gh-pages**，构建会失败（gh-pages 分支只有构建产物，没有 `package.json`，无法执行 `npm install`）。

## 步骤 3: 添加环境变量

在 "Environment Variables" 部分添加：

| 变量名 | 值 |
|--------|-----|
| `VITE_SUPABASE_URL` | `https://trteewgplkqiedonomzg.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydGVld2dwbGtxaWVkb25vbXpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzcwMDIsImV4cCI6MjA4ODU1MzAwMn0.1IteG22e3MYfsupkGcER4SkFc1drA15rMH62_u0o-A0` |

**重要**: 确保变量名前缀是 `VITE_`，这样前端代码才能访问。

## 步骤 4: 部署

1. 点击 "Deploy" 按钮
2. 等待构建完成（约 1-2 分钟）
3. 部署成功后，你会获得一个 `*.vercel.app` 的域名

### 若之前误选了 gh-pages 导致构建失败

1. 打开 Vercel 项目 → **Settings** → **Git**
2. 将 **Production Branch** 改为 **main**，保存
3. 在 **Deployments** 里点击 **Redeploy** 重新部署，或推送新的 commit 到 main 触发部署

## 步骤 5: 配置澳大利亚区域（可选优化）

Vercel 默认使用全球 CDN，你的网站会自动分发到全球包括澳大利亚的节点。

如需进一步优化延迟，可以在 Vercel Dashboard 中：
- 进入项目设置
- 找到 "Regional Availability"
- 确认 "Global" 已启用（默认）

---

## Supabase Edge Functions 说明

你的后端使用的是 Supabase Edge Functions，它们部署在 Supabase 的全球基础设施上。你需要确保在 Supabase Dashboard 中配置了以下环境变量：

1. 访问 [Supabase Dashboard](https://supabase.com/dashboard)
2. 选择你的项目 -> Settings -> Edge Functions
3. 确保以下变量已配置：
   - `SUPABASE_URL`: https://trteewgplkqiedonomzg.supabase.co
   - `SUPABASE_SERVICE_ROLE_KEY`: 你的服务角色密钥
   - `SUPABASE_ANON_KEY`: 你的匿名密钥

---

## 下一步

部署完成后：
1. 测试网站功能是否正常
2. 注册澳大利亚域名（.com.au 或 .au）
3. 在 Vercel 中添加自定义域名
4. 配置 SSL 证书（Vercel 自动提供）
