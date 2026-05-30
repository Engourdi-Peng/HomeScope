import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

/**
 * PKCE exchange 完全由 Supabase SDK 的 detectSessionInUrl 自动处理。
 * 本组件只负责：
 * 1. 等待 SIGNED_IN 事件（SDK exchange 成功后触发）
 * 2. 将 session 推送到 extension（如果是扩展流程）
 * 3. 清理 URL 中的 ?code=
 * 4. 导航回首页
 */

interface PushSessionOptions {
  flowId?: string | null;
}

function pushSessionToExtension(session: Session, options: PushSessionOptions = {}): void {
  const { flowId } = options;

  console.log('[HomeScope AuthCallback] pushSessionToExtension: START');
  console.log('[HomeScope AuthCallback]   userId:', session.user?.id);
  console.log('[HomeScope AuthCallback]   flowId:', flowId);

  const message = {
    source: 'homescope-auth-bridge',
    type: 'HOMESCOPE_SYNC_SESSION',
    payload: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: session.user,
      flowId: flowId || null,
    },
  };

  window.postMessage(message, window.location.origin);
  console.log('[HomeScope AuthCallback] pushSessionToExtension: postMessage dispatched');
}

function getFlowId(): string | null {
  try {
    const stored = sessionStorage.getItem('hs_ext_flow');
    if (stored) {
      const parsed = JSON.parse(stored) as { flowId?: string };
      if (parsed?.flowId) return parsed.flowId;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing your login...');

  // 单例守卫：防止 React StrictMode 双倍执行
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const flowId = getFlowId();
    const isFromExtension = !!flowId;

    console.log('[HomeScope AuthCallback] PAGE LOADED, isFromExtension:', isFromExtension, ', flowId:', flowId);

    let finished = false;

    async function handleSignedIn(session: Session) {
      if (finished) return;
      finished = true;
      subscription.unsubscribe();
      clearTimeout(timeoutId);
      sessionStorage.removeItem('hs_ext_flow');

      // 清理 URL 中的 ?code=
      const url = new URL(window.location.href);
      if (url.searchParams.has('code')) {
        url.searchParams.delete('code');
        window.history.replaceState({}, '', url.pathname + url.search);
        console.log('[HomeScope AuthCallback] cleaned ?code= from URL');
      }

      if (isFromExtension) {
        pushSessionToExtension(session, { flowId });
        setStatus('success');
        setMessage('Login successful! The HomeScope extension is now synced. This tab will close automatically.');
      } else {
        setStatus('success');
        setMessage('Login successful! Redirecting...');
        setTimeout(() => navigate('/', { replace: true }), 1500);
      }
    }

    // 监听 SIGNED_IN：SDK detectSessionInUrl exchange 成功后自动触发
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'SIGNED_IN' && sess) {
        console.log('[HomeScope AuthCallback] onAuthStateChange SIGNED_IN, userId=', sess.user?.id);
        void handleSignedIn(sess);
      }
    });

    // 兜底：SDK exchange 可能在监听器注册前就完成了
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        console.log('[HomeScope AuthCallback] immediate getSession: found session, userId=', data.session.user?.id);
        await handleSignedIn(data.session);
      }
    })();

    // 超时保护
    const timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      subscription.unsubscribe();
      sessionStorage.removeItem('hs_ext_flow');

      // 超时了也要清理 URL，避免刷新后持续报错
      const url = new URL(window.location.href);
      if (url.searchParams.has('code')) {
        url.searchParams.delete('code');
        window.history.replaceState({}, '', url.pathname + url.search);
      }

      setStatus('error');
      setMessage(
        isFromExtension
          ? 'Login timed out: no active session detected. Please try signing in again from the extension.'
          : 'No active session found. Please sign in.'
      );
    }, 30000);

    return () => {
      finished = true;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8f9fa',
        padding: '20px',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          padding: '40px',
          maxWidth: '400px',
          width: '100%',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
          textAlign: 'center',
        }}
      >
        {status === 'loading' && (
          <>
            <Loader2
              style={{
                width: '48px',
                height: '48px',
                color: '#667eea',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 20px',
              }}
            />
            <h2 style={{ margin: '0 0 12px', fontSize: '20px', color: '#333' }}>
              Processing Login
            </h2>
          </>
        )}

        {status === 'success' && (
          <>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: '#d4edda',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#28a745"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <h2 style={{ margin: '0 0 12px', fontSize: '20px', color: '#28a745' }}>
              Success!
            </h2>
          </>
        )}

        {status === 'error' && (
          <>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: '#f8d7da',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#dc3545"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </div>
            <h2 style={{ margin: '0 0 12px', fontSize: '20px', color: '#dc3545' }}>
              Login Failed
            </h2>
          </>
        )}

        <p
          style={{
            margin: '0',
            fontSize: '14px',
            color: '#666',
            lineHeight: '1.6',
          }}
        >
          {message}
        </p>

        {status === 'error' && (
          <a
            href="/"
            style={{
              display: 'inline-block',
              marginTop: '20px',
              padding: '10px 24px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            Go to Home
          </a>
        )}

        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}
