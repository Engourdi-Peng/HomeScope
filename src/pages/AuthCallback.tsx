import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

/** 扩展 Magic Link：会话在网页建立后，经 content script 写入 chrome.storage */
function pushSessionToExtension(session: Session) {
  window.postMessage(
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
}

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromExtension = searchParams.get('from_extension') === '1';

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing your login...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const token = urlParams.get('token');
        const type = urlParams.get('type');

        const finishExtensionFlow = async (session: Session | null) => {
          if (!fromExtension || !session) return false;
          pushSessionToExtension(session);
          setStatus('success');
          setMessage(
            '登录成功！会话已同步到 HomeScope 扩展。请打开扩展侧边栏，或点击「刷新状态」。此标签页可关闭。'
          );
          window.history.replaceState({}, '', window.location.pathname + window.location.search);
          return true;
        };

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error('Auth callback error:', error);
            setStatus('error');
            setMessage(error.message || 'Login failed. Please try again.');
            return;
          }

          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (await finishExtensionFlow(session)) {
            return;
          }

          setStatus('success');
          setMessage('Login successful! Redirecting...');
          window.history.replaceState({}, '', '/');
          setTimeout(() => {
            navigate('/', { replace: true });
          }, 1500);
        } else if (token) {
          setStatus('success');
          setMessage('Login successful! Redirecting...');
          setTimeout(() => {
            navigate('/', { replace: true });
          }, 1500);
        } else if (type === 'recovery') {
          setStatus('success');
          setMessage('Password reset link verified!');
        } else {
          const {
            data: { session },
            error: sessionError,
          } = await supabase.auth.getSession();

          if (sessionError) {
            console.error('Session error:', sessionError);
            setStatus('error');
            setMessage(sessionError.message || 'Login failed. Please try again.');
            return;
          }

          if (session) {
            if (await finishExtensionFlow(session)) {
              return;
            }

            setStatus('success');
            setMessage('Login successful! Redirecting...');
            window.history.replaceState({}, '', '/');
            setTimeout(() => {
              navigate('/', { replace: true });
            }, 1500);
          } else {
            setStatus('error');
            setMessage('Invalid login link. Please request a new magic link.');
          }
        }
      } catch (err) {
        console.error('Auth callback exception:', err);
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
