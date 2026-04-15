// @ts-nocheck — chrome global type not in tsconfig.libs (pre-existing errors suppressed)
import { useState, useEffect, useRef } from 'react';
import { useAppState, useActions } from '../store';
import type { ExtUser } from '../types';

export function GateView() {
  const { authStatus } = useAppState();
  const { sendMagicLink, initiateGoogleOAuth } = useActions();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingForSync, setWaitingForSync] = useState(false);
  /** 避免 setTimeout 闭包捕获 stale waitingForSync */
  const waitingRef = useRef(false);

  // 同步 waitingRef <-> waitingForSync
  useEffect(() => { waitingRef.current = waitingForSync; }, [waitingForSync]);

  // ── 监听 authStatus 变化：background broadcastAuthChanged(true) → store 更新 → 这里捕获 ──
  useEffect(() => {
    if (authStatus === 'logged_in' && waitingRef.current) {
      waitingRef.current = false;
      setWaitingForSync(false);
    } else if (authStatus === 'logged_out' && waitingRef.current) {
      waitingRef.current = false;
      setWaitingForSync(false);
    }
  }, [authStatus]);

  // ── 轮询兜底：Waiting 状态下每 1s 调用 check_auth_status，最多 30s ──
  // 防御：即使 broadcastAuthChanged 消息丢失，轮询也能兜底检测到 background 中的 session
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
      } catch (err) {
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

  /**
   * 点击 Google 登录：
   * 1. 打开网站登录页（新标签）
   * 2. 进入等待状态
   * 3. 登录成功后 background.broadcastAuthChanged(true) → store.tsx message listener
   *    更新 authStatus → 本组件 useEffect 捕获 → 退出等待状态
   * 4. 轮询兜底：每 1s check_auth_status，最多 30s
   */
  const handleGoogleOAuth = async () => {
    setError(null);
    waitingRef.current = true;
    setWaitingForSync(true);

    const result = await initiateGoogleOAuth();

    if (!result.success) {
      console.error('[HomeScope Gate] handleGoogleOAuth: failed —', result.error);
      setError(result.error || 'Failed to open login page');
      waitingRef.current = false;
      setWaitingForSync(false);
      return;
    }
    // 轮询兜底由 useEffect [waitingForSync] 处理，此处无需 setTimeout
  };

  const handleCancelWaiting = () => {
    waitingRef.current = false;
    setWaitingForSync(false);
  };

  if (isSuccess) {
    return (
      <div className="ext-gate">
        <div className="ext-gate-success">
          <div className="ext-gate-success-icon">✓</div>
          <div className="ext-gate-success-title">Check your email</div>
          <div className="ext-gate-success-msg">
            We've sent a magic link to <strong>{email}</strong>
            <br />
            Click the link to sign in on the website.
            <br />
            <br />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              After you click the link: keep this panel open, then open or refresh{' '}
              <strong>www.tryhomescope.com</strong> in a tab — your login will sync to the extension
              automatically. Or use the link again next time; it now includes extension sync.
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (waitingForSync) {
    return (
      <div className="ext-gate">
        <div className="ext-gate-logo">
          <svg xmlns="http://www.w3.org/2000/svg" width="130" height="22" viewBox="0 0 254.145 41.04">
            <g id="logo2" transform="translate(-81.15 -88.79)">
              <path id="_3" data-name="3" d="M128.43,1.62q-5.76,0-8.685-2.925A10.642,10.642,0,0,1,116.82-9.18h6.39a4.362,4.362,0,0,0,1.215,3.262,5.361,5.361,0,0,0,3.87,1.193,9.1,9.1,0,0,0,4.23-.832A3.1,3.1,0,0,0,134.01-8.73a2.489,2.489,0,0,0-1.417-2.07,33.065,33.065,0,0,0-4.342-1.98,41.918,41.918,0,0,1-5.333-2.317,11.549,11.549,0,0,1-3.668-3.1,7.615,7.615,0,0,1-1.53-4.838,9.444,9.444,0,0,1,3.06-7.47,12,12,0,0,1,8.235-2.7,12.951,12.951,0,0,1,6.03,1.328A9.553,9.553,0,0,1,138.96-28.3a9.36,9.36,0,0,1,1.35,4.9h-6.57a2.9,2.9,0,0,0-1.283-2.52,5.888,5.888,0,0,0-3.442-.9,6.653,6.653,0,0,0-3.488.878A3.058,3.058,0,0,0,124.2-22.86a2.568,2.568,0,0,0,1.462,1.98,36.236,36.236,0,0,0,4.342,2.025,59.013,59.013,0,0,1,5.378,2.475,11.824,11.824,0,0,1,3.645,3.06A7.311,7.311,0,0,1,140.58-8.6,10.017,10.017,0,0,1,137.7-1.35Q134.82,1.62,128.43,1.62Zm27.315,0q-5.13,0-7.9-3.285t-2.768-9.5q0-6.3,2.857-9.742a9.808,9.808,0,0,1,7.988-3.443q4.95,0,7.447,2.272t2.768,6.908h-6.255a3.5,3.5,0,0,0-1.058-2.34,4.231,4.231,0,0,0-2.812-.765q-4.5,0-4.5,6.435,0,3.915,1.035,5.648t3.87,1.732a3,3,0,0,0,2.565-.922,5.571,5.571,0,0,0,.9-2.543h6.255q-.405,4.725-2.812,7.133T155.745,1.62Zm25.83.315a10.253,10.253,0,0,1-5.8-1.643,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93A16.409,16.409,0,0,1,172.02-18.2a10.967,10.967,0,0,1,3.848-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,188.39-18.9a17.2,17.2,0,0,1,1.283,6.795q0,6.21-2.835,9.72A9.761,9.761,0,0,1,181.575,1.935Zm0-6.3a3.8,3.8,0,0,0,3.42-1.845,9.451,9.451,0,0,0,1.17-5.085,9.4,9.4,0,0,0-1.192-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.238,5.018,3.851,3.851,0,0,0,3.4,1.912Zm27.4-20.07A9.925,9.925,0,0,1,214.29-23a9.913,9.913,0,0,1,3.69,4.163,14.5,14.5,0,0,1,1.35,6.5,14.726,14.726,0,0,1-1.373,6.57,10.237,10.237,0,0,1-3.735,4.275A9.652,9.652,0,0,1,208.98,0a8.452,8.452,0,0,1-4.59-1.215V7.83h-6.525V-24.39h6.525V-23a7.473,7.473,0,0,1,4.59-1.435Zm-.18,18.5a3.71,3.71,0,0,0,3.195-1.778,8.015,8.015,0,0,0,1.215-4.613,8.209,8.209,0,0,0-1.08-4.477,3.676,3.676,0,0,0-3.325-1.7,3.5,3.5,0,0,0-3.173,1.688,8.347,8.347,0,0,0-1.058,4.477A8.91,8.91,0,0,0,205.628-7.7,3.465,3.465,0,0,0,208.8-5.94Zm21.51-3.24a6.475,6.475,0,0,0,1.485,3.78,3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q223.83-5.04,223.83-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.783-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.3-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(90 122)" fill="#1c1917"/>
              <path id="_2" data-name="2" d="M18.63-19.8V-32.76h6.525V1.62H18.63V-13.725H9.675V1.62H3.15V-32.76H9.675V-19.8ZM41.49,1.935a10.254,10.254,0,0,1-5.8-1.642,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93,16.409,16.409,0,0,1,1.37-6.905,10.967,10.967,0,0,1,3.847-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,51.1-18.09a17.2,17.2,0,0,1,1.28,6.79q0,6.21-2.835,9.72A9.761,9.761,0,0,1,41.49,1.935Zm0-6.3A3.8,3.8,0,0,0,44.91-6.21a9.451,9.451,0,0,0,1.17-5.09A9.4,9.4,0,0,0,44.887-16.3a3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.237,5.018,3.851,3.851,0,0,0,3.4,1.917ZM106.335-9.18A6.475,6.475,0,0,0,107.82-5.4a3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q99.855-5.04,99.855-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.782-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.3-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(78 122)" fill="#707070"/>
              <path id="_1" data-name="1" d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z" transform="translate(-763.436 194.985)" fill="#e17100"/>
            </g>
          </svg>
        </div>

        <div className="ext-gate-subtitle" style={{ marginTop: 20, textAlign: 'center', color: 'var(--text-primary)' }}>
          Sign in on the website
        </div>

        <div style={{ textAlign: 'center', margin: '32px 0 24px', color: 'var(--text-muted)', fontSize: 14 }}>
          <div className="ext-spinner" style={{ margin: '0 auto 16px' }} />
          <p>Waiting for login...</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            A login page has been opened in a new tab.
            <br />
            Complete sign-in there — the extension will update automatically.
          </p>
        </div>

        <button
          className="ext-cta ext-cta--ghost"
          onClick={handleCancelWaiting}
          style={{ width: '100%', fontSize: 13 }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="ext-gate">
      <div className="ext-gate-logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="130" height="22" viewBox="0 0 254.143 41.052">
          <g id="logo2" transform="translate(-81.15 -88.778)">
            <path id="_3" data-name="3" d="M128.43,1.62q-5.76,0-8.685-2.925A10.642,10.642,0,0,1,116.82-9.18h6.39a4.362,4.362,0,0,0,1.215,3.262,5.361,5.361,0,0,0,3.87,1.193,9.1,9.1,0,0,0,4.23-.832A3.1,3.1,0,0,0,134.01-8.73a2.489,2.489,0,0,0-1.417-2.07,33.065,33.065,0,0,0-4.342-1.98,41.918,41.918,0,0,1-5.333-2.317,11.549,11.549,0,0,1-3.668-3.1,7.615,7.615,0,0,1-1.53-4.838,9.444,9.444,0,0,1,3.06-7.47,12,12,0,0,1,8.235-2.7,12.951,12.951,0,0,1,6.03,1.328A9.553,9.553,0,0,1,138.96-28.3a9.36,9.36,0,0,1,1.35,4.9h-6.57a2.9,2.9,0,0,0-1.283-2.52,5.888,5.888,0,0,0-3.442-.9,6.653,6.653,0,0,0-3.488.878A3.058,3.058,0,0,0,124.2-22.86a2.568,2.568,0,0,0,1.462,1.98,36.236,36.236,0,0,0,4.342,2.025,59.013,59.013,0,0,1,5.378,2.475,11.824,11.824,0,0,1,3.645,3.06A7.311,7.311,0,0,1,140.58-8.6,10.017,10.017,0,0,1,137.7-1.35Q134.82,1.62,128.43,1.62Zm27.315,0q-5.13,0-7.9-3.285t-2.768-9.5q0-6.3,2.857-9.742a9.808,9.808,0,0,1,7.988-3.443q4.95,0,7.447,2.272t2.768,6.908h-6.255a3.5,3.5,0,0,0-1.058-2.34,4.231,4.231,0,0,0-2.812-.765q-4.5,0-4.5,6.435,0,3.915,1.035,5.648t3.87,1.732a3,3,0,0,0,2.565-.922,5.571,5.571,0,0,0,.9-2.543h6.255q-.405,4.725-2.812,7.133T155.745,1.62Zm25.83.315a10.253,10.253,0,0,1-5.8-1.643,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93A16.409,16.409,0,0,1,172.02-18.2a10.967,10.967,0,0,1,3.848-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,188.39-18.9a17.2,17.2,0,0,1,1.283,6.795q0,6.21-2.835,9.72A9.761,9.761,0,0,1,181.575,1.935Zm0-6.3a3.8,3.8,0,0,0,3.42-1.845,9.451,9.451,0,0,0,1.17-5.085,9.4,9.4,0,0,0-1.192-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.238,5.018,3.851,3.851,0,0,0,3.4,1.912Zm27.4-20.07A9.925,9.925,0,0,1,214.29-23a9.913,9.913,0,0,1,3.69,4.163,14.5,14.5,0,0,1,1.35,6.5,14.726,14.726,0,0,1-1.373,6.57,10.237,10.237,0,0,1-3.735,4.275A9.652,9.652,0,0,1,208.98,0a8.452,8.452,0,0,1-4.59-1.215V7.83h-6.525V-24.39h6.525V-23a7.473,7.473,0,0,1,4.59-1.435Zm-.18,18.5a3.71,3.71,0,0,0,3.195-1.778,8.015,8.015,0,0,0,1.215-4.613,8.209,8.209,0,0,0-1.08-4.477,3.676,3.676,0,0,0-3.325-1.7,3.5,3.5,0,0,0-3.173,1.688,8.347,8.347,0,0,0-1.058,4.477A8.91,8.91,0,0,0,205.628-7.7,3.465,3.465,0,0,0,208.8-5.94Zm21.51-3.24a6.475,6.475,0,0,0,1.485,3.78,3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q223.83-5.04,223.83-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.783-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.3-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(90 122)" fill="#1c1917"/>
            <path id="_2" data-name="2" d="M18.63-19.8V-32.76h6.525V1.62H18.63V-13.725H9.675V1.62H3.15V-32.76H9.675V-19.8ZM41.49,1.935a10.254,10.254,0,0,1-5.8-1.642,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93,16.409,16.409,0,0,1,1.37-6.905,10.967,10.967,0,0,1,3.847-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,51.1-18.09a17.2,17.2,0,0,1,1.28,6.79q0,6.21-2.835,9.72A9.761,9.761,0,0,1,41.49,1.935Zm0-6.3A3.8,3.8,0,0,0,44.91-6.21a9.451,9.451,0,0,0,1.17-5.09A9.4,9.4,0,0,0,44.887-16.3a3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.237,5.018,3.851,3.851,0,0,0,3.4,1.917ZM106.335-9.18A6.475,6.475,0,0,0,107.82-5.4a3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q99.855-5.04,99.855-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.782-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.3-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(78 122)" fill="#707070"/>
            <path id="_1" data-name="1" d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z" transform="translate(-763.436 194.985)" fill="#e17100"/>
          </g>
        </svg>
      </div>

      <div className="ext-gate-subtitle">
        AI-powered property analysis in your browser
      </div>

      <div className="ext-gate-divider">or continue with</div>

      <div className="ext-gate-form">
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

        <form onSubmit={handleEmailSubmit}>
          <input
            type="email"
            className="ext-input"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            required
          />
          <button
            type="submit"
            className="ext-cta ext-cta--primary"
            disabled={isLoading || !email.trim()}
            style={{ marginTop: 10 }}
          >
            {isLoading ? (
              <>
                <div className="ext-spinner ext-spinner-sm" />
                Sending...
              </>
            ) : (
              'Continue with Email'
            )}
          </button>
        </form>

        {error && (
          <div style={{ color: 'var(--error)', fontSize: 13, textAlign: 'center' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
