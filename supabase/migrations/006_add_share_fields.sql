-- ========================================
-- 添加公开分享功能字段
-- ========================================

-- 添加 is_public 字段（默认 false，私密）
ALTER TABLE public.analyses 
ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- 添加 share_slug 字段（友好的分享链接）
ALTER TABLE public.analyses 
ADD COLUMN IF NOT EXISTS share_slug TEXT;

-- 添加索引以优化公开查询
CREATE INDEX IF NOT EXISTS analyses_share_slug_idx ON public.analyses(share_slug) WHERE is_public = TRUE;

-- ========================================
-- 添加公开访问的 RLS 策略
-- ========================================

-- 允许所有人读取 is_public = TRUE 的分析记录
CREATE POLICY "Anyone can read public analyses" ON public.analyses
  FOR SELECT USING (is_public = TRUE);
