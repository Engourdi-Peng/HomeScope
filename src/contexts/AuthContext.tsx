import { createContext, useContext, useEffect, useState } from 'react';
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

  const creditsRemaining = profile?.credits_remaining ?? 0;
  const isAuthenticated = !!user;

  // 获取用户 profile
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

  // 初始化：监听认证状态和处理 OAuth 回跳
  useEffect(() => {
    const initAuth = async () => {
      try {
        // 检查 URL 中是否存在 auth code
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');

        // 如果存在 code，交换 session（AuthContext 是唯一负责 exchangeCodeForSession 的地方）
        if (code) {
          // 先检查是否已有 session（避免重复 exchange 或竞态条件）
          try {
            const { data: existingSession } = await supabase.auth.getSession();
            if (existingSession?.session) {
              console.log('[AuthContext] initAuth: session already exists, skipping exchange');
              setUser(existingSession.session.user ?? null);
              if (existingSession.session.user) fetchProfile(existingSession.session.user.id);
              return;
            }
          } catch {
            // getSession 失败继续尝试 exchange
          }

          let exchangeSucceeded = false;
          let retryCount = 0;
          const maxRetries = 2;

          while (!exchangeSucceeded && retryCount <= maxRetries) {
            try {
              console.log(`[AuthContext] initAuth: exchanging code... (attempt ${retryCount + 1})`);
              const { error } = await supabase.auth.exchangeCodeForSession(code);

              if (!error) {
                console.log('[AuthContext] initAuth: exchangeCodeForSession succeeded');
                exchangeSucceeded = true;
                // 清除 URL 中的 code 参数
                const url = new URL(window.location.href);
                url.searchParams.delete('code');
                window.history.replaceState({}, '', url.pathname + url.search);
                // 不再立即 getSession — session 通过 onAuthStateChange 的 SIGNED_IN 事件传来
              } else if (error.message?.includes('PKCE code verifier not found')) {
                // PKCE verifier 尚未就绪，等待后重试（处理 SDK 初始化竞态）
                retryCount++;
                if (retryCount <= maxRetries) {
                  console.warn(`[AuthContext] initAuth: PKCE verifier not ready, retrying in 300ms... (${retryCount}/${maxRetries})`);
                  await new Promise(resolve => setTimeout(resolve, 300));
                } else {
                  console.error('[AuthContext] initAuth: PKCE verifier exchange failed after retries:', error.message);
                }
              } else {
                console.warn('[AuthContext] initAuth: exchangeCodeForSession error:', error.message);
                exchangeSucceeded = true;
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              if (errMsg.includes('PKCE code verifier not found') && retryCount < maxRetries) {
                retryCount++;
                console.warn(`[AuthContext] initAuth: PKCE verifier not ready (exception), retrying in 300ms... (${retryCount}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 300));
              } else {
                console.error('[AuthContext] initAuth: exchangeCodeForSession exception:', err);
                exchangeSucceeded = true;
              }
            }
          }
        } else {
          // 无 code：检查是否有已存在的 session（页面刷新时）
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              setUser(session.user ?? null);
              if (session.user) fetchProfile(session.user.id);
            }
          } catch {
            /* ignore — getSession may throw on invalid refresh token */
          }
        }
      } catch (err) {
        console.warn('[AuthContext] initAuth error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // 监听认证状态变化（SIGNED_IN 在 exchangeCodeForSession 写入 IndexedDB 完成后触发）
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: { user: User } | null) => {
      console.log('[AuthContext] onAuthStateChange:', event, session?.user?.id ?? 'null');
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
        setIsLoading(false);

        // ── 扩展流程：推送 session 到 extension ──────────────────────
        // 无论是 /auth/callback 还是根路径 /（Supabase 有时回跳到根路径）
        // 只要 hs_ext_flow 存在，就说明是扩展触发的登录，需要把 session 同步给扩展
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
            // 立即清理 sessionStorage（防止重复推送）
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
    // 检查 URL 参数：flow_id 表示这是扩展发起的登录流程
    const urlParams = new URLSearchParams(window.location.search);
    const flowId = urlParams.get('flow_id'); // flowId 是扩展流程的唯一标记

    if (flowId) {
      // 扩展触发的登录：flowId 存入 sessionStorage（跨标签页传递）
      const extFlowData = JSON.stringify({ flowId });
      sessionStorage.setItem('hs_ext_flow', extFlowData);
      console.log('[Auth] signInWithGoogle: extension flow detected, flowId:', flowId);
    } else {
      console.log('[Auth] signInWithGoogle: normal web flow (no flow_id in URL)');
    }

    // redirectTo 只传 flowId（sessionStorage 作为主要传递方式）
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
