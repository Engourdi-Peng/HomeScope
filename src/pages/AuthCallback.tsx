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

  console.log('[HomeScope AuthCallback]   targetOrigin:', window.location.origin);
  console.log('[HomeScope AuthCallback]   message.type:', message.type);

  window.postMessage(message, window.location.origin);

  console.log('[HomeScope AuthCallback] pushSessionToExtension: postMessage dispatched');
}

/** flow_id 可能在 ?flow_id=、#...&flow_id=，或同标签登录页写入的 sessionStorage */
function extractFlowIdFromPage(): string | null {
  const searchParams = new URLSearchParams(window.location.search);
  let fid = searchParams.get('flow_id');
  if (fid) return fid;
  const h = window.location.hash;
  if (h && h.length > 1) {
    const hashParams = new URLSearchParams(h.startsWith('#') ? h.slice(1) : h);
    fid = hashParams.get('flow_id');
    if (fid) return fid;
  }
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

  useEffect(() => {
    let finished = false;
    let pollId: ReturnType<typeof setInterval> | null = null;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      if (finished) return;
      if (event === 'SIGNED_IN' && sess) {
        console.log('[HomeScope AuthCallback] onAuthStateChange SIGNED_IN, userId=', sess.user?.id);
        void completeWithSession(sess);
      }
    });

    const flowId = extractFlowIdFromPage();
    const isFromExtension = !!flowId;

    console.log('[HomeScope AuthCallback] PAGE LOADED');
    console.log('[HomeScope AuthCallback]   href:', window.location.href);
    console.log('[HomeScope AuthCallback]   flowId:', flowId, 'isFromExtension:', isFromExtension);

    async function tryGetSession(): Promise<Session | null> {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.warn('[HomeScope AuthCallback] getSession error:', error.message);
        return data.session ?? null;
      } catch (e) {
        console.error('[HomeScope AuthCallback] getSession exception:', e);
        return null;
      }
    }

    async function completeWithSession(session: Session) {
      if (finished) return;
      finished = true;
      if (pollId) clearInterval(pollId);
      subscription.unsubscribe();

      console.log('[HomeScope AuthCallback] completeWithSession, isFromExtension=', isFromExtension);

      if (isFromExtension) {
        pushSessionToExtension(session, { flowId });
        setStatus('success');
        setMessage('登录成功！HomeScope 扩展已同步会话。此标签页将自动关闭。');
        sessionStorage.removeItem('hs_ext_flow');
        return;
      }

      setStatus('success');
      setMessage('Login successful! Redirecting...');
      sessionStorage.removeItem('hs_ext_flow');
      window.history.replaceState({}, '', '/');
      setTimeout(() => navigate('/', { replace: true }), 1500);
    }

    function completeWithError(msg: string) {
      if (finished) return;
      finished = true;
      if (pollId) clearInterval(pollId);
      subscription.unsubscribe();
      sessionStorage.removeItem('hs_ext_flow');
      setStatus('error');
      setMessage(msg);
    }

    let attempts = 0;
    const maxAttempts = 55; // ~11s

    pollId = setInterval(async () => {
      if (finished) return;
      attempts += 1;
      const session = await tryGetSession();
      if (session) {
        await completeWithSession(session);
        return;
      }
      if (attempts >= maxAttempts) {
        completeWithError(
          isFromExtension
            ? '登录流程异常：未检测到有效会话。请在扩展中重试。'
            : 'No active session found. Please sign in.'
        );
      }
    }, 200);

    void (async () => {
      await new Promise((r) => setTimeout(r, 80));
      if (finished) return;
      const session = await tryGetSession();
      if (session) await completeWithSession(session);
    })();

    return () => {
      finished = true;
      if (pollId) clearInterval(pollId);
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
