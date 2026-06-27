-- Migration: 014_create_process_transaction_rpc
-- Date: 2026-06-20
-- Description: Create RPC function for atomic payment processing with idempotency.
-- This ensures credits and commissions are processed atomically to prevent
-- duplicate credits on webhook retries.

-- Enable pgcrypto extension for gen_random_uuid if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop existing function if it exists (for re-deploy)
CREATE OR REPLACE FUNCTION public.process_paddle_completed_transaction(
  p_transaction_id TEXT,
  p_user_id UUID,
  p_plan_key TEXT,
  p_credits INTEGER,
  p_affiliate_id UUID DEFAULT NULL,
  p_affiliate_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with service role privileges
AS $$
DECLARE
  v_result JSONB;
  v_existing_id UUID;
  v_commission_amount DECIMAL(10,2);
  v_purchase_amount DECIMAL(10,2);
  v_commission_rate DECIMAL(5,4);
  v_eligible_at TIMESTAMPTZ;
BEGIN
  -- Check if already processed
  SELECT id INTO v_existing_id
  FROM public.processed_payment_events
  WHERE paddle_transaction_id = p_transaction_id;

  IF v_existing_id IS NOT NULL THEN
    -- Already processed, return early
    RETURN jsonb_build_object(
      'already_processed', true,
      'transaction_id', p_transaction_id
    );
  END IF;

  -- Start transaction block
  BEGIN
    -- 1. Add credits atomically using increment
    UPDATE public.profiles
    SET
      credits_remaining = COALESCE(credits_remaining, 0) + p_credits,
      updated_at = now()
    WHERE id = p_user_id;

    -- Check if profile was updated
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile not found for user_id: %', p_user_id;
    END IF;

    -- 2. Record the processed event
    INSERT INTO public.processed_payment_events (
      paddle_transaction_id,
      user_id,
      plan_key,
      credits_added,
      affiliate_id,
      commission_generated,
      status
    ) VALUES (
      p_transaction_id,
      p_user_id,
      p_plan_key,
      p_credits,
      p_affiliate_id,
      FALSE, -- Will be updated if commission is created
      'completed'
    );

    -- 3. If affiliate info provided, create commission
    IF p_affiliate_id IS NOT NULL AND p_affiliate_code IS NOT NULL THEN
      -- Calculate commission
      v_purchase_amount := CASE p_plan_key
        WHEN 'starter' THEN 6.99
        WHEN 'standard' THEN 15.99
        WHEN 'pro' THEN 39.00
        ELSE 0
      END;

      -- Get commission rate from affiliate
      SELECT commission_rate INTO v_commission_rate
      FROM public.affiliates
      WHERE id = p_affiliate_id AND is_active = true;

      -- If affiliate is still valid, create commission
      IF v_commission_rate IS NOT NULL THEN
        v_commission_amount := v_purchase_amount * v_commission_rate;
        v_eligible_at := now() + INTERVAL '30 days';

        INSERT INTO public.affiliate_commissions (
          affiliate_id,
          user_id,
          paddle_transaction_id,
          affiliate_code,
          plan_key,
          purchase_amount,
          currency,
          commission_rate,
          commission_amount,
          status,
          eligible_at
        ) VALUES (
          p_affiliate_id,
          p_user_id,
          p_transaction_id,
          p_affiliate_code,
          p_plan_key,
          v_purchase_amount,
          'USD',
          v_commission_rate,
          v_commission_amount,
          'pending',
          v_eligible_at
        );

        -- Update commission_generated flag
        UPDATE public.processed_payment_events
        SET commission_generated = true
        WHERE paddle_transaction_id = p_transaction_id;
      END IF;
    END IF;

    -- Success
    RETURN jsonb_build_object(
      'success', true,
      'transaction_id', p_transaction_id,
      'credits_added', p_credits,
      'commission_generated', CASE WHEN p_affiliate_id IS NOT NULL AND v_commission_rate IS NOT NULL THEN true ELSE false END
    );

  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback on any error
      RAISE;
  END;
END;
$$;

-- Grant execute permission to service_role
GRANT EXECUTE ON FUNCTION public.process_paddle_completed_transaction TO service_role;
