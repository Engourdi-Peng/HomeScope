-- Migration: 016_create_affiliate_withdrawals
-- Date: 2026-06-29
-- Description: Create affiliate_withdrawals table to track withdrawal requests.
-- MVP stage: Manual processing by admin, no automatic payouts.

CREATE TABLE IF NOT EXISTS public.affiliate_withdrawals (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id      UUID        NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  amount            DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  status            TEXT        NOT NULL DEFAULT 'pending',
  -- Status: pending | approved | paid | rejected
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  admin_note        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for looking up withdrawals by affiliate
CREATE INDEX IF NOT EXISTS idx_withdrawals_affiliate
  ON public.affiliate_withdrawals (affiliate_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_withdrawals_status
  ON public.affiliate_withdrawals (status);

-- Index for pending withdrawals (what admin will see most often)
CREATE INDEX IF NOT EXISTS idx_withdrawals_pending
  ON public.affiliate_withdrawals (requested_at)
  WHERE status = 'pending';

-- RLS: Service role only for MVP
ALTER TABLE public.affiliate_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage withdrawals" ON public.affiliate_withdrawals
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER affiliate_withdrawals_updated_at
  BEFORE UPDATE ON public.affiliate_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
