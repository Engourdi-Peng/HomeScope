import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

/**
 * 将 session 直接推送到 extension background，通过 postMessage 实现。
 * 页面只负责发消息，不等待 extension 响应。
 *
 * 架构：
 * 1. 页面通过 window.postMessage 发送 session（source: 'homescope-auth-bridge'）
 * 2. content script 在 isolated world 监听 message，转发到 background
 * 3. background 保存 session，自动关闭 callback tab
 */
interface PushSessionOptions {
  flowId?: string | null;
}

function pushSessionToExtension(session: Session, options: PushSessionOptions = {}): void {
  const { flowId } = options;
  const hasAccessToken = !!session.access_token;
  const hasRefreshToken = !!session.refresh_token;
  const userId = session.user?.id;

  console.log('[HomeScope AuthCallback] pushSessionToExtension: START');
  console.log('[HomeScope AuthCallback]   hasAccessToken:', hasAccessToken);
  console.log('[HomeScope AuthCallback]   hasRefreshToken:', hasRefreshToken);
  console.log('[HomeScope AuthCallback]   userId:', userId);
  console.log('[HomeScope AuthCallback]   flowId:', flowId);
  console.log('[HomeScope AuthCallback]   accessToken:', session.access_token ? session.access_token.substring(0, 10) + '...' : 'null');

  // 发送 session 到 content script（通过 postMessage）
  const message = {
    source: 'homescope-auth-bridge',
    type: 'HOMESCOPE_SYNC_SESSION',
    payload: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: session.user,
      flowId: flowId || null // 双重校验的 flowId
    }
  };

  console.log('[HomeScope AuthCallback]   targetOrigin: * (any, for extension content script)');
  console.log('[HomeScope AuthCallback]   message.type:', message.type);

  window.postMessage(message, '*');

  console.log('[HomeScope AuthCallback] pushSessionToExtension: postMessage dispatched');
}

/** 扩展 flow_id 通过 URL 参数传入（sessionStorage 跨标签不可达，必须用 URL） */
function getFlowId(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const flowId = params.get('flow_id');
    if (flowId) return flowId;
  } catch {
    /* ignore */
  }
  return null;
}

export function AuthCallback() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing your login...');

  useEffect(() => {
    let finished = false;

    const flowId = getFlowId();
    const isFromExtension = !!flowId;

    console.log('[HomeScope AuthCallback] PAGE LOADED, isFromExtension:', isFromExtension, ', flowId:', flowId);

    async function pushIfSession(session: { user: { id: string }; access_token: string; refresh_token?: string } | null) {
      if (finished || !session) return;
      finished = true;
      subscription.unsubscribe();
      clearTimeout(timeoutId);
      sessionStorage.removeItem('hs_ext_flow');

      if (isFromExtension) {
        pushSessionToExtension(session, { flowId });
        setStatus('success');
        setMessage('Login successful! The HomeScope extension is now synced. This tab will close automatically.');
      } else {
        setStatus('success');
        setMessage('Login successful! Redirecting...');
        window.history.replaceState({}, '', '/');
        setTimeout(() => navigate('/', { replace: true }), 1500);
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'SIGNED_IN' && sess) {
        console.log('[HomeScope AuthCallback] onAuthStateChange SIGNED_IN, userId=', sess.user?.id);
        void pushIfSession(sess);
      }
    });

    // 立即主动检查 session（AuthContext 可能在 AuthCallback 之前处理了 callback，
    // 导致 SIGNED_IN 事件在 AuthCallback 监听器注册前就触发了）
    void (async () => {
      const { data, error } = await supabase.auth.getSession();
      console.log('[HomeScope AuthCallback] immediate getSession:', {
        hasSession: !!data.session,
        userId: data.session?.user?.id,
        error: error?.message,
        url: window.location.href
      });
      if (data.session) {
        await pushIfSession(data.session);
      }
    })();

    const timeoutId = setTimeout(async () => {
      if (finished) return;
      finished = true;
      subscription.unsubscribe();
      sessionStorage.removeItem('hs_ext_flow');

      // 超时时进行诊断检查
      const { data: finalCheck, error: finalError } = await supabase.auth.getSession();
      console.error('[HomeScope AuthCallback] TIMEOUT - final session check:', {
        hasSession: !!finalCheck.session,
        userId: finalCheck.session?.user?.id,
        error: finalError?.message,
        url: window.location.href,
        urlHasCode: window.location.href.includes('code='),
        flowId,
        isFromExtension
      });

      setStatus('error');
      setMessage(
        isFromExtension
          ? 'Login timed out. If the issue persists, try again or use a different browser.'
          : 'No active session found. Please sign in.'
      );
    }, 60000);

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
