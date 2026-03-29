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
