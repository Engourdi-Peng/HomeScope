-- Migration: 011_add_source_columns
-- Date: 2026-05-22
-- Description: Add source and source_domain columns to analyses table
--   to persist market info from extension through to full analysis run.
--   Needed for US/Zillow prompt routing in full analysis flow.

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT NULL;

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS source_domain TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_analyses_source ON analyses(source);
CREATE INDEX IF NOT EXISTS idx_analyses_source_domain ON analyses(source_domain);
