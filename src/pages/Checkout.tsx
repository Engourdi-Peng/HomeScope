import { useEffect, useState, useRef } from 'react';

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
        eventCallback?: (event: PaddleEvent) => void;
      }) => void;
      Checkout?: {
        open: (options: {
          transactionId: string;
          settings?: {
            displayMode?: string;
            theme?: string;
            locale?: string;
          };
        }) => void;
      };
    };
  }
}

interface PaddleEvent {
  name: string;
  data?: {
    id?: string;
    [key: string]: unknown;
  };
}

export function CheckoutPage() {
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);

  const initialized = useRef(false);
  const completedRef = useRef(false);
  const countdownTimer = useRef<number | null>(null);
  const countdownInterval = useRef<number | null>(null);

  useEffect(() => {
    const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
    const paddleEnv = import.meta.env.VITE_PADDLE_ENV || 'sandbox';

    if (!clientToken) {
      setError('Paddle client token not configured. Please contact support.');
      setLoading(false);
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const txnIdFromUrl = urlParams.get('_ptxn');

    console.log('[checkout] current url:', window.location.href);
    console.log('[checkout] txnId from url:', txnIdFromUrl);

    if (!txnIdFromUrl) {
      setError('Missing transaction id. Please try again from the payment link.');
      setLoading(false);
      return;
    }

    if (initialized.current) return;
    initialized.current = true;

    const existingScript = document.querySelector(
      'script[src="https://cdn.paddle.com/paddle/v2/paddle.js"]'
    ) as HTMLScriptElement | null;

    const setupPaddle = () => {
      if (!window.Paddle || typeof window.Paddle.Initialize !== 'function') {
        setError('Paddle SDK loaded, but Initialize() is unavailable.');
        setLoading(false);
        return;
      }

      window.Paddle.Environment.set(paddleEnv);

      window.Paddle.Initialize({
        token: clientToken,
        checkout: {
          settings: {
            displayMode: 'overlay',
            theme: 'light',
            locale: 'en',
          },
        },
        eventCallback: (event: PaddleEvent) => {
          console.log('[checkout] event:', event.name, event.data);

          if (event.name === 'checkout.completed') {
            const completedTxnId = event.data?.id || txnIdFromUrl;
            console.log('[checkout] completed transaction id:', completedTxnId);

            completedRef.current = true;
            setTransactionId(completedTxnId);
            setError(null);
            setClosed(false);
            setLoading(false);
            setSuccess(true);
            setCountdown(3);

            countdownInterval.current = window.setInterval(() => {
              setCountdown((prev) => {
                if (prev <= 1) {
                  if (countdownInterval.current) {
                    clearInterval(countdownInterval.current);
                    countdownInterval.current = null;
                  }
                  return 0;
                }
                return prev - 1;
              });
            }, 1000);

            countdownTimer.current = window.setTimeout(() => {
              console.log('[checkout] redirecting to success page');
              window.location.href = `/payment-success?txn=${completedTxnId}`;
            }, 3000);
          }

          if (event.name === 'checkout.closed') {
            console.log('[checkout] checkout closed');

            if (!completedRef.current) {
              setLoading(false);
              setSuccess(false);
              setClosed(true);
            }
          }
        },
      });

      if (window.Paddle.Checkout && typeof window.Paddle.Checkout.open === 'function') {
        console.log('[checkout] opening checkout for txn:', txnIdFromUrl);
        window.Paddle.Checkout.open({
          transactionId: txnIdFromUrl,
          settings: {
            displayMode: 'overlay',
            theme: 'light',
            locale: 'en',
          },
        });
      } else {
        setError('Paddle checkout is not available. Please try again or contact support.');
        setLoading(false);
      }
    };

    let script: HTMLScriptElement | null = null;

    if (existingScript) {
      setupPaddle();
    } else {
      script = document.createElement('script');
      script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
      script.async = true;
      script.onload = setupPaddle;
      script.onerror = () => {
        setError('Failed to load Paddle. Please refresh and try again.');
        setLoading(false);
      };
      document.body.appendChild(script);
    }

    return () => {
      if (countdownTimer.current) {
        clearTimeout(countdownTimer.current);
      }
      if (countdownInterval.current) {
        clearInterval(countdownInterval.current);
      }
      if (script && document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        {loading && !success && !error && !closed && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600">Loading payment...</p>
          </div>
        )}

        {success && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900">Payment successful!</h2>
            <p className="text-gray-600">Redirecting you in {countdown} seconds...</p>
            <a
              href={`/payment-success?txn=${transactionId}`}
              className="text-blue-600 hover:text-blue-700 underline"
            >
              If not redirected, click here
            </a>
          </div>
        )}

        {closed && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 max-w-md">
            <h2 className="text-yellow-800 text-lg font-semibold mb-2">Payment window closed.</h2>
            <p className="text-yellow-600 mb-4">You closed the payment window before completing the payment.</p>
            <a
              href="/pricing"
              className="inline-block px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
            >
              Back to Pricing
            </a>
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
