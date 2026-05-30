import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, type Profile } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  creditsRemaining: number;
  signInWithGoogle: () => Promise<void>;
  signInWithEmailLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const creditsRemaining = Math.max(0, (profile?.credits_remaining ?? 0) - (profile?.credits_reserved ?? 0));
  const isAuthenticated = !!user;

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        setProfile(null);
      } else {
        setProfile(data as Profile);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
    }
  };

  // 单例守卫：防止 React StrictMode 双倍执行
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initAuth = async () => {
      try {
        // Supabase SDK 通过 detectSessionInUrl: true 自动处理 ?code= exchange
        // 这里只负责恢复已有 session
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setUser(session.user ?? null);
          if (session.user) fetchProfile(session.user.id);
        }
      } catch {
        /* ignore — getSession may throw on invalid refresh token */
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // onAuthStateChange：SDK 的 detectSessionInUrl 在 exchange 完成后会触发 SIGNED_IN
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: { user: User } | null) => {
      console.log('[AuthContext] onAuthStateChange:', event, session?.user?.id ?? 'null');

      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
        setIsLoading(false);

        // ── 清理 URL 中的 ?code=（确认 exchange 成功后再清理）───────────
        const url = new URL(window.location.href);
        if (url.searchParams.has('code')) {
          url.searchParams.delete('code');
          window.history.replaceState({}, '', url.pathname + url.search);
          console.log('[AuthContext] onAuthStateChange: cleaned ?code= from URL');
        }
        // ──────────────────────────────────────────────────────────────

        // ── 扩展流程：推送 session 到 extension ──────────────────────
        try {
          const extFlowRaw = sessionStorage.getItem('hs_ext_flow');
          if (extFlowRaw) {
            const extFlow = JSON.parse(extFlowRaw) as { flowId?: string };
            const flowId = extFlow?.flowId || null;
            const message = {
              source: 'homescope-auth-bridge',
              type: 'HOMESCOPE_SYNC_SESSION',
              payload: {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                user: session.user,
                flowId,
              },
            };
            console.log('[AuthContext] onAuthStateChange: extension flow detected, pushing session via postMessage, flowId=', flowId);
            window.postMessage(message, window.location.origin);
            sessionStorage.removeItem('hs_ext_flow');
          }
        } catch {
          /* ignore storage errors */
        }
        // ─────────────────────────────────────────────────────────
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Google 登录
  const signInWithGoogle = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const flowId = urlParams.get('flow_id');

    if (flowId) {
      const extFlowData = JSON.stringify({ flowId });
      sessionStorage.setItem('hs_ext_flow', extFlowData);
      console.log('[Auth] signInWithGoogle: extension flow detected, flowId:', flowId);
    } else {
      console.log('[Auth] signInWithGoogle: normal web flow (no flow_id in URL)');
    }

    const callbackParams = new URLSearchParams();
    if (flowId) callbackParams.set('flow_id', flowId);
    const redirectTo = `${window.location.origin}/auth/callback${callbackParams.toString() ? '?' + callbackParams.toString() : ''}`;
    console.log('[Auth] signInWithGoogle: redirectTo =', redirectTo);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    });

    if (error) {
      sessionStorage.removeItem('hs_ext_flow');
      console.error('[Auth] signInWithGoogle: OAuth error —', error.message);
      throw error;
    }
  };

  // Email Magic Link 登录
  const signInWithEmailLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      throw error;
    }
  };

  // 登出
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
    setUser(null);
    setProfile(null);
  };

  // 刷新 profile
  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isLoading,
        isAuthenticated,
        creditsRemaining,
        signInWithGoogle,
        signInWithEmailLink,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// 自定义 Hook：使用认证上下文
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
