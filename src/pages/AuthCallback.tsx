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
function pushSessionToExtension(session: Session): void {
  const hasAccessToken = !!session.access_token;
  const hasRefreshToken = !!session.refresh_token;
  const userId = session.user?.id;

  console.log('[HomeScope AuthCallback] pushSessionToExtension: START');
  console.log('[HomeScope AuthCallback]   hasAccessToken:', hasAccessToken);
  console.log('[HomeScope AuthCallback]   hasRefreshToken:', hasRefreshToken);
  console.log('[HomeScope AuthCallback]   userId:', userId);
  console.log('[HomeScope AuthCallback]   accessToken:', session.access_token ? session.access_token.substring(0, 10) + '...' : 'null');

  // 发送 session 到 content script（通过 postMessage）
  const message = {
    source: 'homescope-auth-bridge',
    type: 'HOMESCOPE_SYNC_SESSION',
    payload: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: session.user
    }
  };

  console.log('[HomeScope AuthCallback]   targetOrigin:', window.location.origin);
  console.log('[HomeScope AuthCallback]   message.type:', message.type);

  window.postMessage(message, window.location.origin);

  console.log('[HomeScope AuthCallback] pushSessionToExtension: postMessage dispatched');
}

/** 等待 session 建立（轮询 getSession，最长 5 秒） */
async function waitForSession(maxAttempts = 15, intervalMs = 350): Promise<Session | null> {
  console.log('[HomeScope AuthCallback] waitForSession: starting...');
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      console.log(`[HomeScope AuthCallback] waitForSession: found session after ${i + 1} attempt(s)`);
      return data.session;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.warn('[HomeScope AuthCallback] waitForSession: timeout after', maxAttempts, 'attempts');
  return null;
}

export function AuthCallback() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing your login...');

  useEffect(() => {
    const handleCallback = async () => {
      // ── 1. 打印完整 URL 信息 ──
      console.log('[HomeScope AuthCallback] PAGE LOADED');
      console.log('[HomeScope AuthCallback]   location.href:', window.location.href);
      console.log('[HomeScope AuthCallback]   pathname:', window.location.pathname);
      console.log('[HomeScope AuthCallback]   searchParams:', window.location.search);
      console.log('[HomeScope AuthCallback]   hash:', window.location.hash);

      // ── 2. 检查各种来源标记 ──
      const urlParams = new URLSearchParams(window.location.search);
      const fromExtensionUrl = urlParams.get('from_extension');
      const fromExtensionLocalStorage = localStorage.getItem('hs_login_from_extension');
      const isFromExtension = fromExtensionUrl === '1' || fromExtensionLocalStorage === '1';

      console.log('[HomeScope AuthCallback]   from_extension (URL param):', fromExtensionUrl);
      console.log('[HomeScope AuthCallback]   from_extension (localStorage):', fromExtensionLocalStorage);
      console.log('[HomeScope AuthCallback]   isFromExtension判定:', isFromExtension);

      // ── 3. AuthContext.initAuth() 已经 exchange 过 code 了，这里只读 session ──
      let session: Session | null = null;
      try {
        const result = await supabase.auth.getSession();
        session = result.data.session ?? null;
        console.log('[HomeScope AuthCallback]   getSession: session exists =', !!session);
        if (session) {
          console.log('[HomeScope AuthCallback]   getSession: userId =', session.user?.id);
        }
      } catch (err) {
        console.error('[HomeScope AuthCallback]   getSession EXCEPTION:', err);
      }

      // ── 4. 如果 session 不存在，轮询等待 ──
      if (!session) {
        console.log('[HomeScope AuthCallback]   session not immediately available, polling waitForSession...');
        session = await waitForSession();
        console.log('[HomeScope AuthCallback]   waitForSession result: session exists =', !!session);
      }

      // ── 5. 判定是否来自扩展登录流程 ──
      console.log('[HomeScope AuthCallback]   FINAL判定: isFromExtension =', isFromExtension, '(URL=', fromExtensionUrl, ', LS=', fromExtensionLocalStorage, ')');

      // ── 6. 扩展流程：推送 session 后关闭标签页 ──
      if (isFromExtension && session) {
        console.log('[HomeScope AuthCallback]   → 扩展同步流程: calling pushSessionToExtension...');
        pushSessionToExtension(session);
        setStatus('success');
        setMessage('登录成功！HomeScope 扩展已同步会话。此标签页将自动关闭。');
        console.log('[HomeScope AuthCallback]   → 扩展同步流程: complete, background will save and close tab');

        // 清除标记
        localStorage.removeItem('hs_login_from_extension');
        return;
      }

      // ── 7. 扩展流程：无 session ──
      if (isFromExtension && !session) {
        console.warn('[HomeScope AuthCallback]   → 扩展同步流程: isFromExtension=true but NO session! clearing flag');
        localStorage.removeItem('hs_login_from_extension');
        setStatus('error');
        setMessage('登录流程异常：未检测到有效会话。请在扩展中重试。');
        return;
      }

      // ── 8. 普通网页流程 ──
      console.log('[HomeScope AuthCallback]   → 普通网页流程 (isFromExtension=false)');
      if (session) {
        setStatus('success');
        setMessage('Login successful! Redirecting...');
        localStorage.removeItem('hs_login_from_extension');
        window.history.replaceState({}, '', '/');
        setTimeout(() => navigate('/', { replace: true }), 1500);
      } else {
        console.error('[HomeScope AuthCallback]   → 普通网页流程: NO session, showing error');
        setStatus('error');
        setMessage('No active session found. Please sign in.');
      }
    };

    handleCallback();
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
