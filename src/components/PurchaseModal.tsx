import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export interface PurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    id: string;
    title: string;
    price: string;
    reportCount: number;
  } | null;
}

export function PurchaseModal({ isOpen, onClose, product }: PurchaseModalProps) {
  const { getAffiliateCode, updateAffiliateCode } = useAuth();

  const [affiliateCode, setAffiliateCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Initialize affiliate code from storage when modal opens
  useEffect(() => {
    if (isOpen) {
      const storedCode = getAffiliateCode();
      setAffiliateCode(storedCode);
      setError('');
    }
  }, [isOpen, getAffiliateCode]);

  const handleCodeChange = (code: string) => {
    const normalized = code.trim().toUpperCase();
    setAffiliateCode(normalized);
    // Persist to storage so manual input takes priority over URL ref
    updateAffiliateCode(normalized);
    setError('');
  };

  const handleContinue = async () => {
    if (!product) return;

    setIsLoading(true);
    setError('');

    try {
      // Refresh session
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        throw new Error('Your session has expired. Please sign in again.');
      }
      const token = refreshData.session?.access_token;
      if (!token) {
        throw new Error('No session token available');
      }

      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!anonKey) {
        throw new Error('Missing configuration');
      }

      // Trim and normalize the code before sending
      const trimmedCode = affiliateCode.trim().toUpperCase();
      const codeToSend = trimmedCode || null;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-order`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            product: product.id,
            affiliate_code: codeToSend
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.error === 'INVALID_AFFILIATE_CODE') {
          setError('Invalid creator code. Please check the code or leave it blank.');
          setIsLoading(false);
          return;
        }
        throw new Error(errorData.error || 'Failed to create order');
      }

      const data = await response.json();

      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }

      throw new Error('Checkout URL not received');
    } catch (err) {
      console.error('Checkout error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process purchase');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !product) return null;

  const priceMatch = product.price.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  const priceValue = priceMatch ? parseFloat(priceMatch[0]) : null;
  const perReportLabel =
    priceValue !== null && product.reportCount > 0
      ? `$${(priceValue / product.reportCount).toFixed(2)} per report`
      : null;

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors"
        >
          <X size={20} />
        </button>

        <div className="p-8">
          {/* Title */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-stone-900 mb-1">
              Confirm Purchase
            </h2>
          </div>

          {/* Order Summary */}
          <div className="bg-stone-50 rounded-xl p-4 mb-6">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-semibold text-stone-900">{product.title}</h3>
                <p className="text-sm text-stone-500">
                  {product.reportCount} FULL PROPERTY REPORTS
                </p>
                {perReportLabel && (
                  <p className="text-xs text-stone-400 mt-0.5">{perReportLabel}</p>
                )}
              </div>
              <span className="text-xl font-semibold text-stone-900">{product.price}</span>
            </div>
            <p className="text-xs text-stone-400">
              Taxes may apply at checkout
            </p>
          </div>

          {/* Creator Code Section - Optional */}
          <div className="mb-6">
            <label className="block text-sm text-stone-500 mb-1">
              Creator code (optional)
            </label>
            <p className="text-xs text-stone-400 mb-2">
              No code? You can leave this blank.
            </p>
            <input
              type="text"
              value={affiliateCode}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="Enter creator code"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg text-stone-700 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-300 focus:border-stone-400 transition-colors"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Continue Button */}
          <button
            onClick={handleContinue}
            disabled={isLoading}
            className="w-full py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Processing...
              </>
            ) : (
              'Continue to secure checkout'
            )}
          </button>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-stone-100">
            <div className="flex items-center gap-1 text-xs text-stone-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Secure checkout
            </div>
            <div className="flex items-center gap-1 text-xs text-stone-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Powered by Paddle
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
}
