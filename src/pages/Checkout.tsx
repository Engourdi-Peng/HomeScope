import { useEffect, useState } from 'react';

declare global {
  interface Window {
    Paddle?: {
      Environment: {
        set: (env: string) => void;
      };
      Initialize: (options: {
        token: string;
        checkout?: {
          settings?: {
            displayMode?: 'overlay' | 'inline';
            theme?: string;
            locale?: string;
          };
        };
      }) => void;
      Checkout?: {
        open: (options: { transactionId: string }) => void;
      };
    };
  }
}

export function CheckoutPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
    const paddleEnv = import.meta.env.VITE_PADDLE_ENV || 'sandbox';

    if (!clientToken) {
      setError('Paddle client token not configured. Please contact support.');
      setLoading(false);
      return;
    }

    // 从 URL 获取 _ptxn 参数
    const urlParams = new URLSearchParams(window.location.search);
    const transactionId = urlParams.get('_ptxn');

    if (!transactionId) {
      setError('Missing transaction id. Please try again from the payment link.');
      setLoading(false);
      return;
    }

    // 加载 Paddle.js
    const script = document.createElement('script');
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.async = true;
    script.onload = () => {
      console.log('window.Paddle =', window.Paddle);
      console.log('typeof window.Paddle?.Initialize =', typeof window.Paddle?.Initialize);

      if (!window.Paddle || typeof window.Paddle.Initialize !== 'function') {
        setError('Paddle SDK loaded, but Initialize() is unavailable.');
        setLoading(false);
        return;
      }

      // 设置环境
      window.Paddle.Environment.set(paddleEnv);

      // 初始化 Paddle - Paddle.js 会自动根据 URL 中的 _ptxn 参数打开 checkout
      window.Paddle.Initialize({
        token: clientToken,
        checkout: {
          settings: {
            displayMode: 'overlay',
            theme: 'light',
            locale: 'en',
          },
        },
      });

      // Paddle.js 会自动处理 _ptxn 参数并打开 checkout
      // 我们只需要显示 loading 状态
      setLoading(true);
    };

    script.onerror = () => {
      setError('Failed to load Paddle. Please refresh and try again.');
      setLoading(false);
    };

    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        {loading && !error && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600">Loading payment...</p>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
            <h2 className="text-red-800 text-lg font-semibold mb-2">Payment Error</h2>
            <p className="text-red-600">{error}</p>
            <a
              href="/pricing"
              className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Back to Pricing
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
