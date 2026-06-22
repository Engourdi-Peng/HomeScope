// @ts-nocheck — chrome global type not in tsconfig.libs (pre-existing errors suppressed)
import { useState, useEffect, useRef } from 'react';
import { useAppState, useActions } from '../store';
import type { ExtUser } from '../types';

export function AuthGateSection() {
  const { authStatus } = useAppState();
  const { initiateGoogleOAuth } = useActions();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingForSync, setWaitingForSync] = useState(false);
  const waitingRef = useRef(false);

  // NOTE: Hooks must run unconditionally — NEVER place an early `return null`
  // before the useEffect calls below. Doing so causes React error #310
  // ("Rendered more hooks than during the previous render") when the user
  // transitions between logged_in and logged_out. Keep all hook calls at the
  // top of the component, then conditionally render inside the JSX.
  // See: https://react.dev/errors/310

  // 同步 waitingRef <-> waitingForSync
  useEffect(() => { waitingRef.current = waitingForSync; }, [waitingForSync]);

  // 监听 authStatus 变化
  useEffect(() => {
    if (authStatus === 'logged_in' && waitingRef.current) {
      waitingRef.current = false;
      setWaitingForSync(false);
    } else if (authStatus === 'logged_out' && waitingRef.current) {
      waitingRef.current = false;
      setWaitingForSync(false);
    }
  }, [authStatus]);

  // 轮询兜底
  useEffect(() => {
    if (!waitingForSync) return;

    let elapsed = 0;
    const intervalId = setInterval(async () => {
      elapsed += 1;
      try {
        const response = await new Promise<{ state: string; user?: ExtUser }>((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'check_auth_status' }, (res) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res as { state: string; user?: ExtUser });
          });
        });
        if (response.state === 'authenticated' && response.user) {
          waitingRef.current = false;
          setWaitingForSync(false);
          clearInterval(intervalId);
        } else if (elapsed >= 30) {
          waitingRef.current = false;
          setWaitingForSync(false);
          clearInterval(intervalId);
        }
      } catch {
        if (elapsed >= 30) {
          waitingRef.current = false;
          setWaitingForSync(false);
          clearInterval(intervalId);
        }
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [waitingForSync]);

  const handleGoogleOAuth = async () => {
    setError(null);
    waitingRef.current = true;
    setWaitingForSync(true);
    const result = await initiateGoogleOAuth();
    if (!result.success) {
      setError(result.error || 'Failed to open login page');
      waitingRef.current = false;
      setWaitingForSync(false);
    }
  };

  // 登录态下不渲染（hooks 已经在前面无条件执行过）
  if (authStatus === 'logged_in') return null;

  if (waitingForSync) {
    return (
      <div className="ext-auth-gate">
        <div className="ext-auth-gate-eyebrow">
          Sign in to unlock Full Analysis, save reports, and track every property you check.
        </div>
        <div className="ext-gate-success">
          <div className="ext-gate-success-icon">
            <div className="ext-spinner" />
          </div>
          <div className="ext-gate-success-title">Waiting for login...</div>
          <div className="ext-gate-success-msg">
            A login page has been opened in a new tab.
            <br />
            Complete sign-in there — the extension will update automatically.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ext-auth-gate">
      <div className="ext-auth-gate-eyebrow">
        Sign in to unlock Full Analysis, save reports, and track every property you check.
      </div>

      <button
        type="button"
        className="ext-cta ext-cta--primary ext-cta--muted"
        onClick={handleGoogleOAuth}
        disabled={isLoading}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Continue with Google
      </button>

      {error && (
        <div style={{ color: 'var(--error)', fontSize: 13, textAlign: 'center' }}>
          {error}
        </div>
      )}
    </div>
  );
}
