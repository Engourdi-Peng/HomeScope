import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Sparkles, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated, creditsRemaining, refreshProfile } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orderId = searchParams.get('order_id');
  const status = searchParams.get('status');

  useEffect(() => {
    const handleSuccess = async () => {
      // 刷新用户 profile 以获取最新的 credits
      try {
        await refreshProfile();
      } catch (err) {
        console.error('Error refreshing profile:', err);
      } finally {
        setIsLoading(false);
      }
    };

    handleSuccess();
  }, [refreshProfile]);

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
            <div className="h-6 bg-stone-200 rounded w-32 mx-auto"></div>
          </div>
        ) : (
          <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-center justify-center gap-2">
              <Sparkles size={20} className="text-amber-600" />
              <span className="text-lg font-semibold text-amber-800">
                {creditsRemaining} {creditsRemaining === 1 ? 'analysis' : 'analyses'} available
              </span>
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
        {orderId && (
          <p className="text-xs text-stone-400 mt-8">
            Order ID: {orderId}
          </p>
        )}
      </div>
    </div>
  );
}
