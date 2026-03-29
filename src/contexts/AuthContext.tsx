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
          try {
            const { error } = await supabase.auth.exchangeCodeForSession(code);

            if (!error) {
              // 清除 URL 中的 code 参数，但保留 from_extension=1（让 AuthCallback 能读到它）
              const url = new URL(window.location.href);
              url.searchParams.delete('code');
              window.history.replaceState({}, '', url.pathname + url.search);
            }
          } catch (err) {
            console.error('exchangeCodeForSession exception:', err);
          }
        }

        // 获取当前会话（可能因无效 refresh token 抛错）
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          // 无效或过期的 refresh token：清除本地 session，当作未登录
          await supabase.auth.signOut();
          setUser(null);
          setProfile(null);
        } else {
          setUser(session?.user ?? null);
          if (session?.user) {
            fetchProfile(session.user.id);
          }
        }
      } catch (err) {
        // 捕获 getSession 抛出的异常（如 AuthApiError: Invalid Refresh Token）
        console.warn('Auth init error (clearing session):', err);
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // 监听认证状态变化
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: { user: User } | null) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Google 登录
  const signInWithGoogle = async () => {
    // 检查是否来自扩展的登录流程（URL 参数传递）
    const urlParams = new URLSearchParams(window.location.search);
    const fromExtension =
      urlParams.get('from_extension') === '1' || urlParams.get('from') === 'extension';
    const flowId = urlParams.get('flow_id'); // 双重校验的 flow ID

    if (fromExtension) {
      // 扩展触发的登录：设置标记，在 AuthCallback 中通知扩展并关闭标签页
      localStorage.setItem('hs_login_from_extension', '1');
      console.log('[Auth] signInWithGoogle: from_extension detected, set hs_login_from_extension=1');
      if (flowId) {
        localStorage.setItem('hs_flow_id', flowId);
        console.log('[Auth] signInWithGoogle: flow_id detected:', flowId);
      }
    } else {
      console.log('[Auth] signInWithGoogle: normal web flow (no from_extension)');
    }

    // ⚠️ 关键修复：redirectTo 必须携带 from_extension=1 和 flow_id，确保 callback 能识别扩展登录
    // 否则即使从扩展打开 /login?from_extension=1，Supabase OAuth 回调时也会丢失这个参数
    const callbackParams = new URLSearchParams({ from_extension: '1' });
    if (flowId) {
      callbackParams.set('flow_id', flowId);
    }
    const redirectTo = `${window.location.origin}/auth/callback?${callbackParams.toString()}`;
    console.log('[Auth] signInWithGoogle: redirectTo =', redirectTo, 'fromExtension =', fromExtension, 'flowId =', flowId);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo,
      },
    });

    if (error) {
      // 登录失败时清除标记
      localStorage.removeItem('hs_login_from_extension');
      localStorage.removeItem('hs_flow_id');
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
