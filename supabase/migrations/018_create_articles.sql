-- ========================================
-- 文章分类表
-- ========================================
CREATE TABLE IF NOT EXISTS public.article_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  seo_title TEXT,
  seo_description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS article_categories_slug_idx ON public.article_categories(slug);
CREATE INDEX IF NOT EXISTS article_categories_active_idx ON public.article_categories(is_active);

ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;

-- 公开读取 is_active = true 的分类
CREATE POLICY "Anyone can read active categories" ON public.article_categories
  FOR SELECT USING (is_active = TRUE);

DROP TRIGGER IF EXISTS article_categories_updated_at ON public.article_categories;
CREATE TRIGGER article_categories_updated_at
  BEFORE UPDATE ON public.article_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ========================================
-- 文章主表
-- ========================================
CREATE TABLE IF NOT EXISTS public.articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content_markdown TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  cover_alt TEXT,
  category_id UUID REFERENCES public.article_categories(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  author_name TEXT NOT NULL DEFAULT 'HomeScope Team',
  author_user_id UUID,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','scheduled','published','archived')),
  published_at TIMESTAMPTZ,
  scheduled_for TIMESTAMPTZ,
  reading_time_minutes INTEGER NOT NULL DEFAULT 0,
  seo_title TEXT,
  seo_description TEXT,
  canonical_url TEXT,
  og_image_url TEXT,
  noindex BOOLEAN NOT NULL DEFAULT FALSE,
  word_count INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_slug_idx ON public.articles(slug);
CREATE INDEX IF NOT EXISTS articles_status_idx ON public.articles(status);
CREATE INDEX IF NOT EXISTS articles_published_at_idx ON public.articles(published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS articles_category_idx ON public.articles(category_id);
CREATE INDEX IF NOT EXISTS articles_tags_gin_idx ON public.articles USING GIN (tags);
CREATE INDEX IF NOT EXISTS articles_status_published_idx
  ON public.articles(status, published_at DESC NULLS LAST)
  WHERE status = 'published';

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

-- 公开读取：status=published 且 published_at 已到时间，且未 noindex
CREATE POLICY "Anyone can read published articles" ON public.articles
  FOR SELECT USING (
    status = 'published'
    AND (published_at IS NULL OR published_at <= now())
    AND noindex = FALSE
  );

DROP TRIGGER IF EXISTS articles_updated_at ON public.articles;
CREATE TRIGGER articles_updated_at
  BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ========================================
-- 文章 slug 重定向表
-- ========================================
CREATE TABLE IF NOT EXISTS public.article_redirects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  old_slug TEXT NOT NULL UNIQUE,
  new_slug TEXT NOT NULL,
  article_id UUID REFERENCES public.articles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS article_redirects_old_idx ON public.article_redirects(old_slug);

ALTER TABLE public.article_redirects ENABLE ROW LEVEL SECURITY;

-- 公开读取重定向（用于 API 查询旧 slug 映射）
CREATE POLICY "Anyone can read article redirects" ON public.article_redirects
  FOR SELECT USING (TRUE);

-- ========================================
-- 管理员角色
-- ========================================
-- 使用 Supabase 的 app_metadata.role = 'admin' 作为管理员判定。
-- 这里建一张 article_admins 辅助表记录白名单用户，方便运营管理。
CREATE TABLE IF NOT EXISTS public.article_admins (
  user_id UUID PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.article_admins ENABLE ROW LEVEL SECURITY;
-- 严禁默认授权：仅服务角色能访问