import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://trteewgplkqiedonomzg.supabase.co';

const ADMIN_CHECK_URL = `${SUPABASE_URL}/functions/v1/articles-public?action=is-admin`;

// 内存缓存：同一登录用户在一个 TTL 内只查一次，避免每个 admin 页面都重新请求
const cache = new Map<string, { isAdmin: boolean; at: number }>();
const TTL_MS = 60_000;

interface Props {
  children: ReactNode;
}

export function RequireAdmin({ children }: Props) {
  const { user, isLoading } = useAuth();
  const [state, setState] = useState<'checking' | 'allow' | 'deny'>('checking');

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setState('deny');
      return;
    }

    const cached = cache.get(user.id);
    if (cached && Date.now() - cached.at < TTL_MS) {
      setState(cached.isAdmin ? 'allow' : 'deny');
      return;
    }

    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        if (!cancelled) setState('deny');
        return;
      }

      let isAdmin = false;
      try {
        const res = await fetch(ADMIN_CHECK_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (res.ok) {
          const json = (await res.json()) as { isAdmin?: boolean };
          isAdmin = !!json.isAdmin;
        }
      } catch {
        isAdmin = false;
      }

      if (cancelled) return;
      cache.set(user.id, { isAdmin, at: Date.now() });
      setState(isAdmin ? 'allow' : 'deny');
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isLoading]);

  if (isLoading || state === 'checking') {
    if (!isLoading && !user) {
      // 没在加载、且未登录——直接跳首页，避免显示检查提示
      sessionStorage.setItem('hs_admin_denied', '1');
      return <Navigate to="/" replace />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 text-stone-500 text-sm">
        Checking permissions…
      </div>
    );
  }

  if (!user) {
    sessionStorage.setItem('hs_admin_denied', '1');
    return <Navigate to="/" replace />;
  }

  if (state === 'deny') {
    sessionStorage.setItem('hs_admin_denied', '1');
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default RequireAdmin;