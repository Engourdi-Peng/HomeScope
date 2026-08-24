-- ========================================
-- 文章模块显式 GRANT 与存储策略
-- ========================================
-- 与 009_add_explicit_grants.sql 相同目的：兼容 Supabase 2026-05-30 之后的默认授权变更。

-- 公开读权限
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON public.articles TO anon, authenticated;
GRANT SELECT ON public.article_categories TO anon, authenticated;
GRANT SELECT ON public.article_redirects TO anon, authenticated;

-- 写入权限：仅 service_role（Edge Function）
-- 默认 anon/authenticated 没有任何 INSERT/UPDATE/DELETE。

-- ========================================
-- 存储桶策略：article-media
-- 注意：bucket 本身需要在 Supabase Dashboard 或 `supabase storage` CLI 创建；
-- 这里仅声明对象级策略，假设 bucket name = 'article-media'，且 bucket 为 public。
-- ========================================

-- 公开读：所有 anon 都可以读取 article-media 中的对象（与 bucket public 一致）
DROP POLICY IF EXISTS "Public can read article media" ON storage.objects;
CREATE POLICY "Public can read article media" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'article-media');

-- 仅 service_role 可写入（Edge Function 通过 service_role key 操作）
-- 不为 anon/authenticated 添加 INSERT/UPDATE/DELETE 策略，保持默认拒绝。