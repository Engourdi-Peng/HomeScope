-- ========================================
-- 创建 payments 表
-- 记录用户支付历史，防止 webhook 重复加 credits
-- ========================================

-- 1. 创建 payments 表
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,           -- Vendors 订单号，防止重复
  product_id TEXT NOT NULL,                 -- 产品 ID (starter/standard/pro)
  credits_added INTEGER NOT NULL,           -- 购买的报告数量
  amount DECIMAL(10, 2) NOT NULL,          -- 支付金额
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/paid/failed
  vendor_order_id TEXT,                     -- Vendors 订单 ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 启用 RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 3. RLS 策略
-- 用户可以读取自己的支付记录
CREATE POLICY "Users can read own payments" ON public.payments
  FOR SELECT USING (auth.uid() = user_id);

-- 4. 允许 service role 写入支付记录（webhook 需要）
-- 注：Edge Function 使用 service role key 绕过 RLS

-- 5. 创建防止重复处理的唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_id_unique 
  ON public.payments (order_id) WHERE status = 'paid';

-- 6. 创建 updated_at 自动更新 trigger
CREATE OR REPLACE FUNCTION public.update_payment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_payment_updated_at();
