-- Migration: 012_create_report_feedback
-- Date: 2026-06-03
-- Description: Create report_feedback table for storing user feedback on reports.
-- Supports both authenticated users (via user_id + analysis_id) and
-- anonymous guests (via anonymous_id + listing_fingerprint).

CREATE TABLE IF NOT EXISTS public.report_feedback (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id          TEXT,
  user_id              UUID,
  anonymous_id         TEXT,
  listing_fingerprint  TEXT,
  listing_address      TEXT,
  report_type          TEXT,                      -- 'basic' | 'full'
  rating               TEXT        NOT NULL,       -- 'useful' | 'not_useful'
  reasons              TEXT[]      DEFAULT '{}',
  comment              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.report_feedback ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert feedback (anon key inserts)
CREATE POLICY "Anyone can insert feedback" ON public.report_feedback
  FOR INSERT WITH CHECK (true);

-- Allow anyone to read feedback (for Supabase Dashboard access)
CREATE POLICY "Anyone can read feedback" ON public.report_feedback
  FOR SELECT USING (true);

-- Allow anyone to update feedback (needed for upsert)
CREATE POLICY "Anyone can update feedback" ON public.report_feedback
  FOR UPDATE USING (true);

-- Auto-update updated_at trigger
CREATE OR REPLACE TRIGGER report_feedback_updated_at
  BEFORE UPDATE ON public.report_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Unique constraint: one feedback row per authenticated user + analysis
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_user_analysis
  ON public.report_feedback(user_id, analysis_id)
  WHERE user_id IS NOT NULL AND analysis_id IS NOT NULL;

-- Unique constraint: one feedback row per anonymous user + listing fingerprint
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_anonymous_fingerprint
  ON public.report_feedback(anonymous_id, listing_fingerprint)
  WHERE anonymous_id IS NOT NULL AND listing_fingerprint IS NOT NULL;
