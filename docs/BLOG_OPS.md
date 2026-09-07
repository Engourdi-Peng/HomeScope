# 文章 SEO 启动指南（运营手册）

## 1. 一次性基础设置

1. 部署 Supabase 迁移：
   - `supabase/migrations/018_create_articles.sql`（articles / article_categories / article_redirects / article_admins）
   - `supabase/migrations/019_grant_article_storage.sql`（公开读权限 + storage policy）
2. 创建 Storage bucket `article-media`，设为 public。
3. 在 Supabase SQL 编辑器执行：
   ```sql
   INSERT INTO public.article_admins (user_id, email)
   SELECT id, email FROM auth.users WHERE email = '<管理员邮箱>';
   ```
   多个管理员就多行；只有白名单内的用户可调用 `articles-admin`。
4. 部署 Edge Functions：
   ```
   supabase functions deploy articles-admin
   supabase functions deploy articles-public
   ```
   `supabase/config.toml` 已经为两者设置 `verify_jwt = false`。
5. 部署 Vercel：
   ```
   vercel --prod
   ```
   确认 `vercel.json` 的 `rewrites` 包含 `/blog/:slug`、`/blog`、`/rss.xml` 三条。
6. 在 Google Search Console 提交 `https://www.tryhomescope.com/sitemap.xml` 与 `https://www.tryhomescope.com/rss.xml`。

## 2. 主题集群（种子建议）

围绕三个支柱：

- **Listing review**：listing 分析、listing photo 检查、listing 风险识别。
- **Buying & renting decisions**：看房清单、报价前清单、租客决策。
- **Platform playbooks**：Zillow 使用技巧、listing photo 阅读指南。

每支柱 1 篇核心指南 + 5–10 篇长尾。`scripts/seed-blog.mjs` 已包含 4 篇示例（ID + slug + 内容），部署后调用一次即可灌入。后续登录 `/admin/articles` 即可继续撰写。

## 3. 发布节奏与质量门槛

- 每周 1–2 篇高质量文章，单篇目标 1,200–2,500 字，包含至少 3 张图（带 alt）。
- 发布前必查：
  - title 50–70 字符
  - meta description 140–200 字符
  - 单一 H1，H2 数量 5–12
  - 至少 3 个内链（指向工具页、pricing 页、其他文章）
  - cover image 有 alt，描述主体
  - 末尾添加 1 个 CTA（指向 `/` 工具、`/pricing`、相关文章）
- 发布后提交 Search Console → URL inspection → Request indexing。

## 4. 转化跟踪

- 文章详情页底部 CTA 已链接到 `/`。前端埋点（`@vercel/analytics`）：
  - 在 `Article.tsx` 增加 `track('blog_cta_click', { slug })` 上报到 `analytics.track`。
- 后续可补充 GA4：
  - 文章阅读完成事件（scroll depth ≥ 80%）
  - 文章 → 注册转化漏斗

## 5. 维护与更新

- 每季度检查旧文：刷新数据，追加新的内链、CTA。
- 监控 Search Console 中的：
  - Index coverage（已编入索引 / 排除 / 错误）
  - Search performance（曝光、点击率、平均排名）
- 月度总结：导出 `/admin/articles` 列表（CSV），用于内容盘点。

## 6. 不允许做的事

- 不要让 admin 后台之外的代码持有 service_role key；所有写入必须经 `articles-admin`。
- 不要把草稿/预览/管理员页加入 sitemap 或开放爬取（已通过 robots.txt 屏蔽）。
- 不要批量生成 AI 内容；每篇都需要人工审核关键词、事实与免责声明。