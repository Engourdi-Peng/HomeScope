import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';

export function AuthorizePage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');

  useEffect(() => {
    const processAuthorization = async () => {
      try {
        const callback = searchParams.get('callback');
        const userId = searchParams.get('user_id');
        const userEmail = searchParams.get('user_email');

        if (!callback || !userId) {
          setStatus('error');
          return;
        }

        // 获取当前 session 的 token
        const { supabase } = await import('../lib/supabase');
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setStatus('error');
          return;
        }

        // 构建回调 URL，包含 token 信息
        const callbackUrl = new URL(callback);
        callbackUrl.hash = new URLSearchParams({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user_id: userId,
          user_email: userEmail || session.user?.email || ''
        }).toString();

        // 跳转到回调页面
        window.location.href = callbackUrl.toString();
      } catch (err) {
        console.error('Authorization error:', err);
        setStatus('error');
      }
    };

    processAuthorization();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            {status === 'processing' && (
              <>
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Connecting to HomeScope Extension...</h2>
                <p className="text-gray-600">Please wait while we establish a secure connection.</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Established!</h2>
                <p className="text-gray-600">
                  You can now close this tab and use the HomeScope extension.
                </p>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-red-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Failed</h2>
                <p className="text-gray-600 mb-4">
                  Please make sure you are signed in to HomeScope before connecting the extension.
                </p>
                <a
                  href="/login"
                  className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Go to Sign In
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
