-- Migration: 015_add_affiliate_user_binding
-- Date: 2026-06-29
-- Description: Add user_id binding to affiliates table so affiliates are linked to user accounts.
-- This allows the system to identify which logged-in users are affiliates.

-- Add user_id column to affiliates table
ALTER TABLE public.affiliates
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Add unique constraint (one affiliate account per user)
-- First drop existing unique constraint on code if needed, then add unique on user_id
-- Note: We keep the code unique (invite code), but now user_id is also unique per affiliate
ALTER TABLE public.affiliates
ADD CONSTRAINT affiliates_user_id_unique UNIQUE (user_id);

-- Create index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_affiliates_user_id
  ON public.affiliates (user_id)
  WHERE user_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.affiliates.user_id IS 'Linked Supabase user account ID. If NULL, this is a legacy affiliate without account binding.';

-- Add RLS policy to allow affiliates to view their own record (via service role only for now)
-- Since all tables use service_role only, no additional RLS needed for MVP
