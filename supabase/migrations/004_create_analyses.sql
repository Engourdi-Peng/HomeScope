-- ========================================
-- 创建 analyses 表 - 存储用户分析历史
-- ========================================
CREATE TABLE IF NOT EXISTS public.analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, done, failed
  overall_score INTEGER, -- 摘要：总分
  verdict TEXT, -- 摘要：判定结果
  title TEXT, -- 摘要：标题（可选）
  address TEXT, -- 摘要：地址（可选）
  cover_image_url TEXT, -- 摘要：封面图（第一张图）
  summary JSONB, -- 摘要：轻量级 summary（不存完整大 JSON）
  full_result JSONB, -- 完整结果（可选，用于重新查看详情）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================================
-- 索引
-- ========================================
CREATE INDEX IF NOT EXISTS analyses_user_id_idx ON public.analyses(user_id);
CREATE INDEX IF NOT EXISTS analyses_created_at_idx ON public.analyses(created_at DESC);

-- ========================================
-- 启用 RLS
-- ========================================
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

-- 用户可以读取自己的所有分析记录
CREATE POLICY "Users can read own analyses" ON public.analyses
  FOR SELECT USING (auth.uid() = user_id);

-- 用户可以插入自己的分析记录
CREATE POLICY "Users can insert own analyses" ON public.analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 用户可以更新自己的分析记录
CREATE POLICY "Users can update own analyses" ON public.analyses
  FOR UPDATE USING (auth.uid() = user_id);

-- ========================================
-- 创建 updated_at 自动更新 trigger
-- ========================================
CREATE TRIGGER analyses_updated_at
  BEFORE UPDATE ON public.analyses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
