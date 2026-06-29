import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../shared/config';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // 显式 PKCE：回调为 ?code=...，避免隐式 #access_token= 导致 flow_id 丢失、与扩展校验脱节
    flowType: 'pkce',
  },
});

export type { User };

export interface Profile {
  id: string;
  email: string;
  credits_remaining: number;
  credits_reserved: number;
  credits_used: number;
  created_at: string;
  updated_at: string;
}

// ========== Affiliate Types ==========

export interface Affiliate {
  id: string;
  user_id: string | null;
  code: string;
  name: string;
  email: string | null;
  commission_rate: number;
  is_active: boolean;
  payout_method: string | null;
  payout_account: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AffiliateCommission {
  id: string;
  affiliate_id: string;
  user_id: string;
  paddle_transaction_id: string;
  affiliate_code: string;
  plan_key: string;
  purchase_amount: number;
  currency: string;
  commission_rate: number;
  commission_amount: number;
  status: 'pending' | 'available' | 'paid' | 'reversed';
  eligible_at: string;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  buyer_email?: string;
}

export interface AffiliateWithdrawal {
  id: string;
  affiliate_id: string;
  amount: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  requested_at: string;
  processed_at: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AffiliateStats {
  totalCommission: number;
  pendingCommission: number;
  availableToWithdraw: number;
  paidOut: number;
  totalPurchases: number;
  totalBuyers: number;
}

export interface AffiliateDashboardData {
  affiliate: Pick<Affiliate, 'id' | 'code' | 'name' | 'commission_rate' | 'is_active'>;
  stats: AffiliateStats;
  purchases: AffiliateCommission[];
  currentWithdrawal: AffiliateWithdrawal | null;
}
