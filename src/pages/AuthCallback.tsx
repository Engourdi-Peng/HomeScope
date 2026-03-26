import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

/** 通过 postMessage 将 session 推送到 content script，由它转发给 background */
function pushSessionToExtension(session: Session): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      console.warn('[AuthCallback] pushSessionToExtension: timeout, assuming success');
      resolve(true); // 超时也当成功处理，扩展下次刷新会同步到
    }, 15000);

    const handleMessage = (event: MessageEvent) => {
      // 接受来自扩展 sidepanel 的回应
      if (!event.origin.startsWith('chrome-extension://')) return;
      if (event.data?.type === 'HOMESCOPE_SESSION_RECEIVED') {
        clearTimeout(timeout);
        window.removeEventListener('message', handleMessage);
        console.log('[AuthCallback] extension confirmed session received');
        resolve(true);
      }
    };

    window.addEventListener('message', handleMessage);

    window.parent.postMessage(
      {
        source: 'homescope-auth-bridge',
        type: 'HOMESCOPE_PUSH_SESSION_TO_EXTENSION',
        payload: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user: session.user,
        },
      },
      window.location.origin
    );
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

  // 从 URL 直接解析（不能用 useSearchParams，因为 AuthContext 清除 code 后
  // React Router 的 searchParams 可能是旧的）
  const url = new URL(window.location.href);
  const fromExtension = url.searchParams.get('from_extension') === '1';

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing your login...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // AuthContext.initAuth() 已经 exchange 过 code 了，这里只读 session
        // 先立即试一次（code exchange 后 session 通常已经就绪）
        let { data } = await supabase.auth.getSession();
        if (!data.session) {
          // 兜底：轮询等待 session（OAuth code exchange 是异步的）
          data.session = await waitForSession();
        }

        const session = data.session ?? null;

        // ── 扩展流程：推送 session 后关闭标签页 ──
        if (fromExtension) {
          if (session) {
            console.log('[AuthCallback] from_extension=true, pushing session to extension');
            await pushSessionToExtension(session);
            setStatus('success');
            setMessage('登录成功！HomeScope 扩展已同步会话。此标签页将自动关闭。');
            // 延迟关闭，让用户看到成功提示
            setTimeout(() => {
              window.close();
            }, 2500);
          } else {
            setStatus('error');
            setMessage('无法获取登录会话。请重新尝试登录。');
          }
          return;
        }

        // ── 普通网页流程 ──
        if (session) {
          setStatus('success');
          setMessage('Login successful! Redirecting...');
          window.history.replaceState({}, '', '/');
          setTimeout(() => navigate('/', { replace: true }), 1500);
        } else {
          setStatus('error');
          setMessage('No active session found. Please sign in.');
        }
      } catch (err) {
        console.error('[AuthCallback] exception:', err);
        setStatus('error');
        setMessage('An unexpected error occurred. Please try again.');
      }
    };

    handleCallback();
  }, [navigate, fromExtension]);

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
