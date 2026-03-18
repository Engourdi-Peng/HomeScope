import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

export function AuthCompletePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const processAuth = async () => {
      try {
        // 从 URL 参数获取 token
        const accessToken = searchParams.get('access_token');
        const refreshToken = searchParams.get('refresh_token');
        const userId = searchParams.get('user_id');
        const userEmail = searchParams.get('user_email');
        const error = searchParams.get('error');

        if (error) {
          setStatus('error');
          setMessage(error);
          return;
        }

        if (!accessToken) {
          setStatus('error');
          setMessage('No access token received');
          return;
        }

        // 将 token 存入 chrome.storage.local（仅在扩展上下文中可用）
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          await chrome.storage.local.set({
          access_token: accessToken,
          refresh_token: refreshToken,
          user: {
            id: userId,
            email: userEmail
          },
          auth_time: Date.now()
          });
        }

        setStatus('success');
        setMessage('Extension connected successfully!');
      } catch (err) {
        console.error('Auth complete error:', err);
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    processAuth();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            {status === 'loading' && (
              <>
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Connecting...</h2>
                <p className="text-gray-600">Please wait while we connect your extension.</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Connected!</h2>
                <p className="text-gray-600 mb-6">{message}</p>
                <p className="text-sm text-gray-500">
                  You can now close this tab and use the HomeScope extension.
                </p>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8 text-red-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Failed</h2>
                <p className="text-gray-600 mb-6">{message}</p>
                <button
                  onClick={() => navigate('/login?from=extension')}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Try Again
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
