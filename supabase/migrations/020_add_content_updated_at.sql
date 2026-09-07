-- ========================================
-- articles.content_updated_at
-- 目的：
--   published_at       = 首次正式发布时间（一旦设置永不修改）
--   updated_at         = 通用数据库更新时间（含 status / 调度 / 统计）
--   content_updated_at = 公开内容最后一次实质修改时间
--                       （仅当 title/excerpt/content/slug/cover/og/seo/canonical/tags/category/author 真实值变化时刷新）
-- 触发器用 IS DISTINCT FROM 做值变化检测，避免"无变化保存"也刷新 lastmod。
-- 不做历史 backfill：旧文章 content_updated_at 保持 NULL，
--   sitemap / JSON-LD 已通过 ?? published_at fallback 正确处理。
-- 不创建索引：sitemap 仅读取该字段，不按其过滤/排序。
-- ========================================

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.update_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    OLD.title            IS DISTINCT FROM NEW.title            OR
    OLD.excerpt          IS DISTINCT FROM NEW.excerpt          OR
    OLD.content_markdown IS DISTINCT FROM NEW.content_markdown OR
    OLD.content_html     IS DISTINCT FROM NEW.content_html     OR
    OLD.slug             IS DISTINCT FROM NEW.slug             OR
    OLD.cover_image_url  IS DISTINCT FROM NEW.cover_image_url  OR
    OLD.cover_alt        IS DISTINCT FROM NEW.cover_alt        OR
    OLD.og_image_url     IS DISTINCT FROM NEW.og_image_url     OR
    OLD.seo_title        IS DISTINCT FROM NEW.seo_title        OR
    OLD.seo_description  IS DISTINCT FROM NEW.seo_description  OR
    OLD.canonical_url    IS DISTINCT FROM NEW.canonical_url    OR
    OLD.tags             IS DISTINCT FROM NEW.tags             OR
    OLD.category_id      IS DISTINCT FROM NEW.category_id      OR
    OLD.author_name      IS DISTINCT FROM NEW.author_name
  ) THEN
    NEW.content_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS articles_content_updated_at ON public.articles;
CREATE TRIGGER articles_content_updated_at
  BEFORE UPDATE OF
    title, excerpt, content_markdown, content_html,
    slug, cover_image_url, cover_alt, og_image_url,
    seo_title, seo_description, canonical_url,
    tags, category_id, author_name
  ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.update_content_updated_at();
