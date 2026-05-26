-- ========================================
-- Migration: 009_add_explicit_grants
-- Date: 2026-05-14
-- Description:
--   Supabase 自 2026 年 5 月 30 日起，新项目的 public schema 表默认不再向
--   Data API 暴露。需要显式授予角色权限才能通过 supabase-js、PostgREST 等访问。
--   此迁移确保所有表有正确的显式 GRANT，使 RLS 策略生效。
--
-- 角色说明：
--   - anon:      未认证请求（匿名）
--   - authenticated: 已登录用户（JWT 验证通过）
--   - service_role:  服务端密钥，完全绕过 RLS（Edge Functions 用此 key）
--
-- 更多信息: https://supabase.com/docs/guides/database/postgres/row-level-security
-- ========================================

-- ========================================
-- 1. analysis_states
--    被 Edge Functions（anon key）通过 /rest/v1/ 直接调用：
--    - INSERT（创建新状态，analyze 函数）
--    - SELECT（轮询状态，前端轮询 + Edge Function）
--    - UPDATE（更新状态，analyze 函数）
-- ========================================
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE ON public.analysis_states TO anon;

-- ========================================
-- 2. profiles
--    被以下位置通过 /rest/v1/ 调用：
--    - paddle-webhook（anon key）：SELECT 检查 credits
--    - vendors-webhook（service_role key）：不受 RLS 影响
--    - analyze（anon key）：SELECT 检查 credits，UPDATE 扣减
-- ========================================
GRANT SELECT, UPDATE ON public.profiles TO anon;

-- ========================================
-- 3. analyses
--    "Anyone can read public analyses" 策略依赖 anon 角色有 SELECT 权限。
--    不授予 INSERT/UPDATE DELETE，RLS 策略会进一步限制。
-- ========================================
GRANT SELECT ON public.analyses TO anon;

-- ========================================
-- 4. usage_records
--    只有 authenticated 用户需要读写自己的记录，RLS 策略已覆盖。
--    anon 不需要访问此表。
--    但为了安全起见，显式确保只有 authenticated 可以访问：
-- ========================================
GRANT SELECT, INSERT ON public.usage_records TO authenticated;

-- ========================================
-- 5. payments
--    - SELECT: authenticated 用户读自己的记录（RLS 已覆盖）
--    - INSERT: service_role（webhooks，绕过 RLS）或 authenticated（用户操作）
--    RLS 策略 "Users can read own payments" 已覆盖 SELECT。
--    INSERT 依赖 service_role 或 authenticated with RLS。
--    为确保 webhook 能正常工作（service_role bypasses RLS，无需 grant）：
--    验证已有策略允许 service_role 写入。
--    这里显式授予 authenticated INSERT（RLS WITH CHECK 会限制只能插入自己的记录）：
-- ========================================
GRANT INSERT ON public.payments TO authenticated;

-- ========================================
-- 6. 验证当前权限分配
--    （可以在 Supabase Dashboard SQL Editor 中执行以下查询确认）
-- ========================================
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.table_privileges
-- WHERE grantee IN ('anon', 'authenticated')
--   AND table_name IN ('analysis_states', 'profiles', 'analyses', 'usage_records', 'payments')
-- ORDER BY table_name, grantee, privilege_type;
