import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

const SUPABASE_PROJECT_REF = 'trteewgplkqiedonomzg';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;

// 打印当前配置信息（用于调试）
console.log('🔧 Supabase Config:');
console.log('  - PROJECT_REF:', SUPABASE_PROJECT_REF);
console.log('  - URL:', SUPABASE_URL);
console.log('  - ANON_KEY:', SUPABASE_ANON_KEY ? `${SUPABASE_ANON_KEY.slice(0, 20)}...${SUPABASE_ANON_KEY.slice(-10)}` : 'MISSING!');
console.log('  - CURRENT_ORIGIN:', typeof window !== 'undefined' ? window.location.origin : 'N/A (server-side)');

if (!SUPABASE_ANON_KEY) {
  throw new Error('VITE_SUPABASE_ANON_KEY is missing. Please set it in your .env file.');
}

// 导出 Supabase 客户端（用于认证）
// 使用 implicit 流程以更好地支持 OAuth 回调
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'implicit',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// 调试：打印客户端配置
console.log('🔧 Supabase Client created with auth config:', {
  flowType: 'pkce',
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
});

// 导出常用类型
export type { User };

// Profile 类型定义
export interface Profile {
  id: string;
  email: string;
  credits_remaining: number;
  credits_reserved: number;
  credits_used: number;
  created_at: string;
  updated_at: string;
}
