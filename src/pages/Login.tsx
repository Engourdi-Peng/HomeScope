import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Loader2, CheckCircle, ExternalLink } from 'lucide-react';

export function LoginPage() {
  const { signInWithEmailLink, signInWithGoogle, user, isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const fromExtension = searchParams.get('from') === 'extension';

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extensionAuth, setExtensionAuth] = useState<'pending' | 'success' | 'error'>('pending');
  const [authMessage, setAuthMessage] = useState('');

  // 如果是从扩展来的，登录成功后自动触发授权
  useEffect(() => {
    if (fromExtension && isAuthenticated && user && extensionAuth === 'pending') {
      triggerExtensionAuth();
    }
  }, [fromExtension, isAuthenticated, user]);

  const triggerExtensionAuth = async () => {
    if (!user) return;
    setAuthMessage('Connecting to HomeScope extension...');

    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        setExtensionAuth('error');
        setAuthMessage('Could not auto-connect. You can manually add this extension in browser settings.');
        return;
      }
      // 通知 background script 启动授权流程
      // 它会打开回调页面，callback 页面会将 token 存入 chrome.storage
      const response = await chrome.runtime.sendMessage({
        action: 'start_extension_auth',
        user: { id: user.id, email: user.email }
      });

      if (response?.success) {
        setExtensionAuth('success');
        setAuthMessage('HomeScope extension connected successfully!');
      } else {
        setExtensionAuth('error');
        setAuthMessage(response.error || 'Failed to connect extension');
      }
    } catch (err) {
      console.error('Extension auth error:', err);
      // 如果 chrome.runtime.sendMessage 失败（可能是在非扩展环境中）
      // 显示 token 信息让用户手动复制
      setExtensionAuth('error');
      setAuthMessage('Could not auto-connect. You can manually add this extension in browser settings.');
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    setError(null);

    try {
      await signInWithEmailLink(email);
      setMagicLinkSent(true);
    } catch (err) {
      console.error('Failed to send magic link:', err);
      setError(err instanceof Error ? err.message : 'Failed to send magic link');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('Failed to login with Google:', err);
      setError(err instanceof Error ? err.message : 'Failed to login with Google');
    } finally {
      setIsLoading(false);
    }
  };

  // 从扩展来的登录成功页面
  if (fromExtension && isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full">
            <div className="bg-white rounded-xl shadow-lg p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                {extensionAuth === 'success' ? (
                  <CheckCircle className="w-8 h-8 text-green-600" />
                ) : extensionAuth === 'error' ? (
                  <ExternalLink className="w-8 h-8 text-red-600" />
                ) : (
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                )}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {extensionAuth === 'success' ? 'Extension Connected!' : 'Connecting Extension...'}
              </h2>

              <p className="text-gray-600 mb-4">
                Signed in as <strong>{user?.email}</strong>
              </p>

              <p className="text-sm text-gray-500 mb-6">
                {authMessage}
              </p>

              {extensionAuth === 'success' && (
                <p className="text-sm text-gray-500">
                  You can now close this tab and use the HomeScope extension.
                </p>
              )}

              {extensionAuth === 'error' && (
                <div className="space-y-3">
                  <p className="text-sm text-red-600">{authMessage}</p>
                  <button
                    onClick={() => setExtensionAuth('pending')}
                    className="text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 普通登录页面
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900">Welcome to HomeScope</h1>
              <p className="text-gray-600 mt-2">Sign in to analyze rental properties</p>
            </div>

            {magicLinkSent ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Check your email</h2>
                <p className="text-gray-600 mb-4">
                  We've sent a magic link to <strong>{email}</strong>
                </p>
                <p className="text-sm text-gray-500">
                  Click the link in the email to sign in. The link will expire in 24 hours.
                </p>
                <button
                  onClick={() => setMagicLinkSent(false)}
                  className="mt-6 text-blue-600 hover:text-blue-700 font-medium"
                >
                  Use a different email
                </button>
              </div>
            ) : (
              <>
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                      Email address
                    </label>
                    <input
                      type="email"
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-600">{error}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="w-5 h-5" />
                        Send Magic Link
                      </>
                    )}
                  </button>
                </form>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">Or continue with</span>
                  </div>
                </div>

                <button
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                  className="w-full bg-white hover:bg-gray-50 text-gray-700 font-medium py-3 px-4 rounded-lg border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </button>
              </>
            )}
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            By signing in, you agree to our{' '}
            <a href="/terms" className="text-blue-600 hover:underline">Terms of Service</a>
            {' '}and{' '}
            <a href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}
