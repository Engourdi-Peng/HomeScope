-- ========================================
-- Migration: 010_remove_us_fk_constraints
-- Date: 2026-05-21
-- Description:
--   US 项目（Supabase US region）专用迁移：
--   1. 删除 public.analyses.user_id 到 auth.users 的外键约束（US 只作为普通 UUID 使用）。
--   2. 为 public.analysis_states 添加 status、progress 列。
--   3. 为 public.analyses 添加 report_mode 列（如果尚未存在）。
-- ========================================

-- ========================================
-- Step 1: 删除 analyses.user_id 的外键约束
--
-- auth.users 的参照已被删除（migration 004 中定义）：
--   REFERENCES auth.users(id) ON DELETE CASCADE
--
-- PostgreSQL 自动创建了一个外键约束（通常名为 analyses_user_id_fkey），
-- 依赖 auth.users 表。auth.users 在 US 项目中不存在或不可引用，
-- 因此必须先删除该约束，否则任何读 analyses 的操作都可能报错。
--
-- 先查找约束名（兼容所有迁移状态：可能已存在、已被删除、或从未创建）：
-- ========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'analyses'
      AND kcu.column_name = 'user_id'
  ) THEN
    -- 动态获取约束名并删除（避免硬编码约束名导致迁移在某些环境下失败）
    EXECUTE (
      SELECT 'ALTER TABLE public.analyses DROP CONSTRAINT "' || tc.constraint_name || '"'
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = 'analyses'
        AND kcu.column_name = 'user_id'
      LIMIT 1
    );
  END IF;
END $$;

-- 将 user_id 改为纯 UUID（非 NOT NULL，因为某些旧数据可能为 null）
-- 并保留其他约束（NOT NULL 仍保留，但不再引用 auth.users）
ALTER TABLE public.analyses
  ALTER COLUMN user_id TYPE UUID USING user_id::UUID;

-- ========================================
-- Step 2: 为 analysis_states 添加 status 列
-- ========================================
ALTER TABLE public.analysis_states
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued';

-- ========================================
-- Step 3: 为 analysis_states 添加 progress 列
-- ========================================
ALTER TABLE public.analysis_states
  ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;

-- ========================================
-- Step 4: 为 analysis_states 确保 report_mode 列存在
--   （migration 008 已添加，此处仅防重复添加）
-- ========================================
ALTER TABLE public.analysis_states
  ADD COLUMN IF NOT EXISTS report_mode TEXT NOT NULL DEFAULT 'rent';

-- ========================================
-- Step 5: 为 analyses 确保 report_mode 列存在
--   （migration 008 已添加，此处仅防重复添加）
-- ========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analyses'
      AND column_name = 'report_mode'
  ) THEN
    ALTER TABLE public.analyses
      ADD COLUMN report_mode TEXT NOT NULL DEFAULT 'rent'
        CHECK (report_mode IN ('rent', 'sale'));
  END IF;
END $$;

-- ========================================
-- Step 6: 更新旧记录的状态（仅当旧记录 status 为 NULL 时）
--   analyses 表：旧记录 status 可能为 'pending' / 'processing' 等
--   analysis_states 表：新 status 列默认为 'queued'
-- ========================================
UPDATE public.analysis_states
  SET status = 'queued'
  WHERE status IS NULL;

UPDATE public.analyses
  SET report_mode = 'rent'
  WHERE report_mode IS NULL;

UPDATE public.analysis_states
  SET report_mode = 'rent'
  WHERE report_mode IS NULL;
