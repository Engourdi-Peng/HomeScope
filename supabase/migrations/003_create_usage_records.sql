-- ========================================
-- 创建 usage_records 表记录每次分析
-- ========================================
CREATE TABLE IF NOT EXISTS public.usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'reserved',  -- reserved, completed, released
  credits_change INT NOT NULL DEFAULT 0,  -- 变化的 credits 数量
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;

-- 用户只能读取自己的记录
CREATE POLICY "Users can read own usage records" ON public.usage_records
  FOR SELECT USING (auth.uid() = user_id);

-- ========================================
-- 创建 updated_at 自动更新 trigger
-- ========================================
CREATE TRIGGER usage_records_updated_at
  BEFORE UPDATE ON public.usage_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
