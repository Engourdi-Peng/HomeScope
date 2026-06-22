-- Migration: 013_create_affiliate_mvp
-- Date: 2026-06-20
-- Description: Create affiliate MVP tables for creator code / referral commission system.
-- Each payment is independently settled based on the creator code entered at checkout.
-- No first-touch attribution, no user binding to creators.

-- ============================================
-- 1. AFFILIATES TABLE
-- Stores creator/influencer accounts and their referral codes.
-- ============================================

CREATE TABLE IF NOT EXISTS public.affiliates (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  code              TEXT        UNIQUE NOT NULL,
  name              TEXT        NOT NULL,
  email             TEXT,
  commission_rate    DECIMAL(5,4) NOT NULL DEFAULT 0.4000,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  payout_method     TEXT,
  payout_account    TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for code lookup (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_affiliates_code_upper
  ON public.affiliates (upper(code));

-- Index for active affiliates
CREATE INDEX IF NOT EXISTS idx_affiliates_active
  ON public.affiliates (is_active) WHERE is_active = true;

-- ============================================
-- 2. AFFILIATE_COMMISSIONS TABLE
-- Records commission for each successful payment with a valid creator code.
-- ============================================

CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id         UUID        NOT NULL REFERENCES public.affiliates(id),
  user_id              UUID        NOT NULL REFERENCES public.profiles(id),
  paddle_transaction_id TEXT        NOT NULL UNIQUE,
  affiliate_code       TEXT        NOT NULL,
  plan_key             TEXT        NOT NULL,
  purchase_amount      DECIMAL(10,2) NOT NULL,
  currency             TEXT        NOT NULL DEFAULT 'USD',
  commission_rate      DECIMAL(5,4) NOT NULL,
  commission_amount    DECIMAL(10,2) NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending',
  -- Status: pending | approved | paid | reversed
  eligible_at          TIMESTAMPTZ NOT NULL,
  -- 30 days after creation for chargeback observation period
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for affiliate lookup
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate
  ON public.affiliate_commissions (affiliate_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_commissions_status
  ON public.affiliate_commissions (status);

-- Index for eligible commissions
CREATE INDEX IF NOT EXISTS idx_commissions_eligible
  ON public.affiliate_commissions (eligible_at)
  WHERE status = 'pending';

-- ============================================
-- 3. PROCESSED_PAYMENT_EVENTS TABLE
-- Idempotency table to prevent duplicate credits and commissions.
-- Paddle webhooks can be retried; this table ensures each transaction
-- is processed exactly once.
-- ============================================

CREATE TABLE IF NOT EXISTS public.processed_payment_events (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  paddle_transaction_id  TEXT        NOT NULL UNIQUE,
  user_id                UUID        NOT NULL REFERENCES public.profiles(id),
  plan_key               TEXT        NOT NULL,
  credits_added          INTEGER     NOT NULL,
  affiliate_id           UUID        REFERENCES public.affiliates(id),
  commission_generated   BOOLEAN     NOT NULL DEFAULT false,
  status                 TEXT        NOT NULL DEFAULT 'completed',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- RLS POLICIES
-- All affiliate-related tables are service-role only.
-- ============================================

ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_payment_events ENABLE ROW LEVEL SECURITY;

-- affiliates: service role only
CREATE POLICY "Service role can manage affiliates" ON public.affiliates
  FOR ALL USING (auth.role() = 'service_role');

-- affiliate_commissions: service role only
CREATE POLICY "Service role can manage commissions" ON public.affiliate_commissions
  FOR ALL USING (auth.role() = 'service_role');

-- processed_payment_events: service role only
CREATE POLICY "Service role can manage payment events" ON public.processed_payment_events
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- SAMPLE DATA (for testing)
-- Remove or update before production
-- ============================================

-- INSERT INTO public.affiliates (code, name, email, commission_rate)
-- VALUES
--   ('JENNY40', 'Jenny', 'jenny@example.com', 0.4000),
--   ('MIKE40', 'Mike', 'mike@example.com', 0.4000),
--   ('PREMIUM50', 'Premium Partner', 'partner@example.com', 0.5000);

-- ============================================
-- HELPER FUNCTION FOR UPDATED_AT
-- ============================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE OR REPLACE TRIGGER affiliates_updated_at
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER affiliate_commissions_updated_at
  BEFORE UPDATE ON public.affiliate_commissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
