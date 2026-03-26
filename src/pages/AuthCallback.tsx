import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

/**
 * 将 session 直接推送到 extension background，通过注入 <script> 标签实现。
 *
 * 架构：
 * 1. content script 将 __HOMESCOPE_SYNC_SESSION__ 函数挂到 window 上
 * 2. 页面注入的 <script> 调用该函数，函数体在 content script 世界执行（可访问 chrome.* API）
 * 3. content script → chrome.runtime.sendMessage → background 保存 session
 * 4. background 关闭回调标签并通过 postMessage 回调通知页面
 */
function pushSessionToExtension(session: Session): Promise<boolean> {
  return new Promise((resolve) => {
    console.log('[AuthCallback] pushSessionToExtension: starting injected script approach...');
    console.log('[AuthCallback]   access_token exists:', !!session.access_token);
    console.log('[AuthCallback]   user.id:', session.user?.id);

    // 10 秒超时
    const timeout = setTimeout(() => {
      cleanup();
      console.error('[AuthCallback] pushSessionToExtension: TIMEOUT — extension did not respond');
      resolve(false);
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', handleBgResponse);
    }

    // 监听 content script 通过 postMessage 广播的回执（HOMESCOPE_SESSION_ACK 由 content script 在收到 background 响应后发出）
    function handleBgResponse(event: MessageEvent) {
      if (!event.origin.startsWith('chrome-extension://')) return;
      if (event.data?.type === 'HOMESCOPE_SESSION_ACK') {
        cleanup();
        console.log('[AuthCallback] ✓ background confirmed session saved');
        resolve(event.data?.success !== false);
      }
    }
    window.addEventListener('message', handleBgResponse);

    // 注入脚本：调用 content script 暴露在 window 上的同步函数（函数体在 content script 世界执行，可访问 chrome.*）
    const injectedScript = document.createElement('script');
    injectedScript.textContent = `
      (function() {
        console.log('[AuthCallback] injected script: calling window.__HOMESCOPE_SYNC_SESSION__...');
        if (typeof window.__HOMESCOPE_SYNC_SESSION__ === 'function') {
          window.__HOMESCOPE_SYNC_SESSION__({
            access_token: ${JSON.stringify(session.access_token)},
            refresh_token: ${JSON.stringify(session.refresh_token)},
            user: ${JSON.stringify(session.user)}
          }, function(success, error) {
            console.log('[AuthCallback] injected script: __HOMESCOPE_SYNC_SESSION__ callback: success=' + success, 'error=' + error);
            window.postMessage({ type: 'HOMESCOPE_SESSION_ACK', success: success }, window.location.origin);
          });
        } else {
          console.error('[AuthCallback] injected script: window.__HOMESCOPE_SYNC_SESSION__ not found — content script may not be loaded on this page');
          window.postMessage({ type: 'HOMESCOPE_SESSION_ACK', success: false }, window.location.origin);
        }
      })();
    `;
    document.documentElement.appendChild(injectedScript);
    console.log('[AuthCallback] injected script appended to DOM');
  });
}

/** 等待 session 建立（轮询 getSession，最长 3 秒） */
async function waitForSession(maxAttempts = 10, intervalMs = 300): Promise<Session | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      console.log(`[AuthCallback] waitForSession: found session after ${i + 1} attempt(s)`);
      return data.session;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.warn('[AuthCallback] waitForSession: session not found after max attempts');
  return null;
}

export function AuthCallback() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing your login...');

  useEffect(() => {
    const handleCallback = async () => {
      console.log('[AuthCallback] PAGE LOADED');
      console.log('[AuthCallback]   location.href:', window.location.href);
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const fromExt = url.searchParams.get('from_extension');
      console.log('[AuthCallback]   code exists:', !!code, '  from_extension:', fromExt);

      // AuthContext.initAuth() 已经 exchange 过 code 了，这里只读 session
      const { data } = await supabase.auth.getSession();
      let session: Session | null = data.session ?? null;
      console.log('[AuthCallback]   getSession result: session exists =', !!session);

      if (!session) {
        console.log('[AuthCallback]   session not immediately available, polling waitForSession...');
        session = await waitForSession();
        console.log('[AuthCallback]   waitForSession result: session exists =', !!session);
      }

      // ── 扩展流程：推送 session 后关闭标签页 ──
      if (fromExt === '1') {
        console.log('[AuthCallback]   from_extension=1 → entering extension sync flow');
        if (session) {
          console.log('[AuthCallback]   session ready, calling pushSessionToExtension...');
          const ok = await pushSessionToExtension(session);
          if (ok) {
            setStatus('success');
            setMessage('登录成功！HomeScope 扩展已同步会话。此标签页将自动关闭。');
            console.log('[AuthCallback]   pushSessionToExtension → success, background will close tab');
          } else {
            console.error('[AuthCallback]   pushSessionToExtension → FAILED');
            setStatus('error');
            setMessage('无法同步会话到扩展。请确保扩展已启用，或刷新扩展后重试。');
          }
        } else {
          console.error('[AuthCallback]   NO SESSION after all retries — cannot sync to extension');
          setStatus('error');
          setMessage('无法获取登录会话。请重新尝试登录。');
        }
        return;
      }

      // ── 普通网页流程 ──
      console.log('[AuthCallback]   normal web flow (no from_extension)');
      if (session) {
        setStatus('success');
        setMessage('Login successful! Redirecting...');
        window.history.replaceState({}, '', '/');
        setTimeout(() => navigate('/', { replace: true }), 1500);
      } else {
        console.error('[AuthCallback]   no session, showing error');
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
