// @ts-nocheck — chrome global type not in tsconfig.libs (pre-existing errors suppressed)
import { useState, useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';
import { useAppState, useActions } from '../store';
import type { ExtUser } from '../types';

const noop = (..._args: unknown[]) => {};

/* =========================================================
   GateView — 通用 Basic Analysis 入口组件
   =========================================================
   variant="primary" (default): 未登录用户，主 CTA，黑色圆角胶囊按钮
   variant="secondary":       登录用户，次级入口，浅色描边按钮
   ========================================================= */
export function GateView({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const { propertyStatus } = useAppState();
  const { startAnalysis } = useActions();
  const isDetected = propertyStatus === 'detected';
  const isSecondary = variant === 'secondary';

  const handleFreeAnalysis = () => {
    startAnalysis({ bypassCache: true, analysisType: 'basic' });
  };

  return (
    <div className={`${isSecondary ? 'ext-gate-secondary' : 'ext-freemium-main'}`}>
      <button
        type="button"
        className={`${isSecondary ? 'ext-gate-secondary-btn' : `ext-freemium-main-cta ${isDetected ? 'ext-freemium-main-cta--ready' : 'ext-freemium-main-cta--neutral'}`}`}
        onClick={handleFreeAnalysis}
      >
        <Zap size={18} strokeWidth={2.5} />
        <span>{isSecondary ? 'Run Quick Basic Check' : 'Start Free Basic Analysis'}</span>
      </button>
      <p className={`${isSecondary ? 'ext-gate-secondary-hint' : 'ext-freemium-main-hint'}`}>
        {isSecondary
          ? 'Text-only check · no photos · no credits used'
          : 'No sign-in required — instant basic report'}
      </p>
    </div>
  );
}

/* =========================================================
   FreemiumEntry — 登录转化入口组件
   =========================================================
   放在 AnalyseSection 下方，未登录用户可见：
   - Upsell 卡片（Unlock Full Analysis + 功能点 + 强调文案）
   - 登录方式（Google / Magic Link）
   ========================================================= */
export function FreemiumEntry() {
  const { sendMagicLink, initiateGoogleOAuth } = useActions();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingForSync, setWaitingForSync] = useState(false);
  const waitingRef = useRef(false);

  useEffect(() => { waitingRef.current = waitingForSync; }, [waitingForSync]);

  // 监听 background 广播的登录成功消息
  useEffect(() => {
    const handleMessage = (msg: Record<string, unknown>) => {
      if (msg.action === 'auth_status_changed') {
        if (msg.authenticated && waitingRef.current) {
          waitingRef.current = false;
          setWaitingForSync(false);
        } else if (!msg.authenticated && waitingRef.current) {
          waitingRef.current = false;
          setWaitingForSync(false);
        }
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

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

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsLoading(true);
    setError(null);
    const result = await sendMagicLink(email.trim());
    if (result.success) {
      setIsSuccess(true);
    } else {
      setError(result.error || 'Failed to send magic link');
    }
    setIsLoading(false);
  };

  const handleGoogleOAuth = async () => {
    setError(null);
    waitingRef.current = true;
    setWaitingForSync(true);
    const result = await initiateGoogleOAuth();
    if (!result.success) {
      noop(result.error);
      setError(result.error || 'Failed to open login page');
      waitingRef.current = false;
      setWaitingForSync(false);
    }
  };

  const handleCancelWaiting = () => {
    waitingRef.current = false;
    setWaitingForSync(false);
  };

  // Magic link 发送成功
  if (isSuccess) {
    return (
      <div className="ext-freemium-entry">
        <div className="ext-freemium-entry-success">
          <div className="ext-freemium-entry-success-icon">✓</div>
          <div className="ext-freemium-entry-success-title">Check your email</div>
          <div className="ext-freemium-entry-success-msg">
            We've sent a magic link to <strong>{email}</strong>
            <br />
            Click the link to sign in on the website.
          </div>
        </div>
      </div>
    );
  }

  // 等待登录同步
  if (waitingForSync) {
    return (
      <div className="ext-freemium-entry">
        <div className="ext-freemium-entry-waiting">
          <div className="ext-spinner" />
          <p className="ext-freemium-entry-waiting-title">Waiting for login...</p>
          <p className="ext-freemium-entry-waiting-sub">
            A login page has been opened in a new tab.
            <br />
            Complete sign-in there — the extension will update automatically.
          </p>
          <button
            type="button"
            className="ext-freemium-entry-cancel-btn"
            onClick={handleCancelWaiting}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // 登录转化主视图
  return (
    <div className="ext-freemium-entry">
      <div className="ext-freemium-entry-divider">
        <span>Want the full picture?</span>
      </div>

      <div className="ext-freemium-entry-upsell">
        <p className="ext-freemium-entry-upsell-eyebrow">Unlock Full Analysis</p>
        <p className="ext-freemium-entry-upsell-bonus">
          Sign in and get <strong>3 free deep analyses</strong>
        </p>
        <ul className="ext-freemium-entry-upsell-features">
          <li>AI photo review &amp; hidden defect detection</li>
          <li>Carrying costs &amp; investment context</li>
          <li>Competition risk assessment</li>
          <li>Space and layout review</li>
        </ul>
      </div>

      <button
        type="button"
        className="ext-freemium-entry-google-btn"
        onClick={handleGoogleOAuth}
        disabled={isLoading}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Sign in with Google
      </button>

      <form onSubmit={handleEmailSubmit} className="ext-freemium-entry-magic">
        <input
          type="email"
          className="ext-input"
          placeholder="Your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          required
        />
        <button type="submit" className="ext-freemium-entry-magic-btn" disabled={isLoading || !email.trim()}>
          {isLoading ? <div className="ext-spinner ext-spinner-sm" /> : 'Sign in'}
        </button>
      </form>

      {error && (
        <div className="ext-freemium-entry-error">{error}</div>
      )}
    </div>
  );
}
