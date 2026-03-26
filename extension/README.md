# Chrome 扩展（HomeScope）

## 加载方式（重要）

在 `chrome://extensions` 中点击 **「加载已解压的扩展程序」** 时，请选择 **`extension/dist`** 目录，**不要**选 `extension` 根目录。

根目录下的 `sidepanel.html` 仅作源码模板；构建后会复制到 `dist/`，并与 `assets/sidepanel-ext.js` / `sidepanel-ext.css` 配套使用。

## 构建

在项目根目录执行：

```bash
npm run build:extension
```

然后重新在 Chrome 里 **刷新** 扩展。

## Magic link 与扩展同步

1. 在 **Supabase Dashboard → Authentication → URL Configuration** 中，将  
   `https://www.tryhomescope.com/auth/callback?from_extension=1`  
   加入 **Redirect URLs**（若已允许 `https://www.tryhomescope.com/auth/callback`，通常带查询参数也可通过，以控制台为准）。

2. 从扩展发邮件登录后，邮件里的链接会打开网站并完成 `from_extension=1` 流程，会话会通过页面 `postMessage` 写入扩展。

3. **若你已在网页登录、扩展仍显示「查收邮件」**：在浏览器中 **打开或刷新** `https://www.tryhomescope.com` 任意页面，内容脚本会从网页的 Supabase 存储读取会话并同步到扩展；然后侧栏会自动变为已登录（或关闭再打开侧栏）。

## Google 登录（扩展内）

扩展通过 **Supabase OAuth（PKCE）** 打开 Google，不再使用占位 `client_id`（否则会出现 `401 invalid_client`）。

在 **Supabase → Authentication → URL Configuration → Redirect URLs** 中，必须添加 **Chrome 扩展的重定向地址**：

1. 在 `chrome://extensions` 打开「开发者模式」，找到本扩展的 **扩展 ID**（32 位字符串）。
2. 添加：`https://<你的扩展ID>.chromiumapp.org/`
   - 末尾斜杠可有可无，以 Supabase 控制台是否严格匹配为准；若失败可两种都试。
3. 确保 **Google** 已在 Supabase **Providers** 中启用，且 Google Cloud 里的 OAuth 客户端 ID/密钥已填在 Supabase（与网站一致即可）。

未配置上述 Redirect URL 时，登录完成后可能报「No authorization code or tokens in redirect」。
