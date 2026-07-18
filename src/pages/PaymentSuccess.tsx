import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// Polling cadence: refresh profile every 3s up to 30 times (90s total).
// Paddle webhook usually arrives within a few seconds; this is a generous ceiling.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30;

function resolveTransactionId(searchParams: URLSearchParams): string | null {
  // Preferred key written by Checkout; fall back to historical aliases.
  return (
    searchParams.get('transaction_id') ||
    searchParams.get('order_id') ||
    searchParams.get('txn') ||
    null
  );
}

export function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const { creditsRemaining, refreshProfile } = useAuth();

  // Seed initial credits from the value already in memory (set during auth init).
  // We compare against this baseline so we can stop polling as soon as credits grow.
  const initialCreditsRef = useRef<number>(creditsRemaining);

  const [isLoading, setIsLoading] = useState(true);
  const [creditsUpdated, setCreditsUpdated] = useState(false);
  const [pollExhausted, setPollExhausted] = useState(false);

  const transactionId = resolveTransactionId(searchParams);
  const status = searchParams.get('status');

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let intervalId: number | null = null;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;

      try {
        await refreshProfile();
      } catch (err) {
        console.error('[PaymentSuccess] refreshProfile error:', err);
      }

      if (cancelled) return;

      // Read latest credits from the closure's reference via a functional check
      // by re-reading from a ref kept in sync via a separate effect below.
      const current = currentCreditsRef.current;
      if (current > initialCreditsRef.current) {
        setCreditsUpdated(true);
        setIsLoading(false);
        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
        return;
      }

      if (attempts >= POLL_MAX_ATTEMPTS) {
        setPollExhausted(true);
        setIsLoading(false);
        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }
    };

    // Fire one immediate refresh, then start polling.
    void tick();
    intervalId = window.setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [refreshProfile]);

  // Mirror creditsRemaining into a ref so the polling loop can read the latest value.
  const currentCreditsRef = useRef<number>(creditsRemaining);
  useEffect(() => {
    currentCreditsRef.current = creditsRemaining;
  }, [creditsRemaining]);

  // 如果支付状态不是成功
  if (status === 'failed') {
    return (
      <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-stone-900 mb-3">Payment Failed</h1>
          <p className="text-stone-600 mb-8">
            Your payment was not successful. Please try again or contact support.
          </p>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 px-6 py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 transition-colors"
          >
            Try Again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        {/* 成功图标 */}
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-in zoom-in duration-300">
          <CheckCircle size={40} className="text-green-600" />
        </div>

        {/* 标题 */}
        <h1 className="text-3xl font-light tracking-tight text-stone-900 mb-3">
          Payment Successful
        </h1>

        {/* 描述 */}
        <p className="text-stone-600 mb-8">
          Your reports have been added to your account. You can now analyze more rental listings.
        </p>

        {/* 当前 credits */}
        {isLoading ? (
          <div className="mb-8 p-4 bg-stone-100 rounded-xl animate-pulse">
            <div className="flex items-center justify-center gap-2">
              <Loader2 size={18} className="animate-spin text-stone-500" />
              <span className="text-stone-500 text-sm">Updating your credits...</span>
            </div>
          </div>
        ) : creditsUpdated ? (
          <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-center justify-center gap-2">
              <Sparkles size={20} className="text-amber-600" />
              <span className="text-lg font-semibold text-amber-800">
                {creditsRemaining} {creditsRemaining === 1 ? 'analysis' : 'analyses'} available
              </span>
            </div>
          </div>
        ) : (
          <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                <Sparkles size={20} className="text-amber-600" />
                <span className="text-lg font-semibold text-amber-800">
                  {creditsRemaining} {creditsRemaining === 1 ? 'analysis' : 'analyses'} available
                </span>
              </div>
              <p className="text-xs text-amber-700 mt-1">
                Your payment is being processed. If your credits don't update within a few minutes, please contact support.
              </p>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 transition-colors"
          >
            Start Analyzing
            <ArrowRight size={18} />
          </Link>
          <Link
            to="/pricing"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white border border-stone-200 text-stone-700 rounded-xl font-medium hover:bg-stone-50 transition-colors"
          >
            Buy More
          </Link>
        </div>

        {/* 订单信息 */}
        {transactionId && (
          <p className="text-xs text-stone-400 mt-8">
            Transaction ID: {transactionId}
          </p>
        )}
      </div>
    </div>
  );
}