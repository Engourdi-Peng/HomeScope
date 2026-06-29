import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAffiliateDashboard, requestAffiliateWithdrawal } from '../lib/api';
import { ArrowLeft, Copy, Check, DollarSign, Clock, CheckCircle, AlertCircle, Gift, Users, ShoppingCart, TrendingUp } from 'lucide-react';

interface Purchase {
  id: string;
  paddle_transaction_id: string;
  plan_key: string;
  purchase_amount: number;
  commission_amount: number;
  status: 'pending' | 'available' | 'paid' | 'reversed';
  eligible_at: string;
  created_at: string;
  buyer_email: string;
}

interface AffiliateData {
  affiliate: {
    id: string;
    code: string;
    name: string;
    commission_rate: number;
    is_active: boolean;
  };
  stats: {
    totalCommission: number;
    pendingCommission: number;
    availableToWithdraw: number;
    paidOut: number;
    totalPurchases: number;
    totalBuyers: number;
  };
  purchases: Purchase[];
  currentWithdrawal: {
    id: string;
    amount: number;
    status: string;
    requested_at: string;
  } | null;
}

export function AffiliateDashboardPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<AffiliateData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/');
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Fetch dashboard data
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const dashboardData = await getAffiliateDashboard();
        setData(dashboardData);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated]);

  const handleCopyCode = async () => {
    if (!data?.affiliate.code) return;
    
    try {
      await navigator.clipboard.writeText(data.affiliate.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleWithdraw = async () => {
    if (!data || data.stats.availableToWithdraw <= 0) return;

    try {
      setWithdrawing(true);
      const result = await requestAffiliateWithdrawal();
      
      if (result.success) {
        setWithdrawMessage(result.message);
        // Refresh data
        const dashboardData = await getAffiliateDashboard();
        setData(dashboardData);
      } else {
        setWithdrawMessage(result.message);
      }
    } catch (err) {
      console.error('Failed to request withdrawal:', err);
      setWithdrawMessage(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setWithdrawing(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  const getDaysLeft = (eligibleDate: string) => {
    const now = new Date();
    const eligible = new Date(eligibleDate);
    const diff = Math.ceil((eligible.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  };

  const getStatusBadge = (status: string, eligibleDate?: string) => {
    if (status === 'paid') {
      return { bg: 'bg-green-50', text: 'text-green-700', label: 'Paid' };
    }
    if (status === 'reversed') {
      return { bg: 'bg-red-50', text: 'text-red-700', label: 'Reversed' };
    }
    if (status === 'available') {
      return { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Available' };
    }
    // pending status
    const daysLeft = eligibleDate ? getDaysLeft(eligibleDate) : 0;
    if (daysLeft === 0) {
      return { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Available' };
    }
    return { bg: 'bg-amber-50', text: 'text-amber-700', label: `Pending (${daysLeft}d)` };
  };

  const getPlanLabel = (planKey: string) => {
    const labels: Record<string, string> = {
      starter: 'Starter',
      standard: 'Standard',
      pro: 'Pro',
    };
    return labels[planKey] || planKey;
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-stone-300 border-t-stone-600 rounded-full"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-stone-300 border-t-stone-600 rounded-full mx-auto mb-4"></div>
          <p className="text-stone-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-stone-900 mb-2">Unable to Load Dashboard</h2>
          <p className="text-stone-500 mb-6">{error}</p>
          <button
            onClick={() => navigate('/account')}
            className="px-6 py-2 bg-stone-900 text-white text-sm font-medium rounded-xl hover:bg-stone-800 transition-colors"
          >
            Back to Account
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { affiliate, stats, purchases, currentWithdrawal } = data;

  return (
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-12 px-4 sm:px-6 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply pointer-events-none overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1720442617080-c25f9955194c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHptaW5pbWFsaXN0JTIwbW9kZXJuJTIwaG91c2UlMjBleHRlcmlvciUyMGFyY2hpdGVjdHVyZSUyMHdoaXRlfGVufDF8fHx8MTc3MzE5ODI5NHww&ixlib=rb-4.1.0&q=80&w=1080"
          alt="Background"
          className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent"></div>
      </div>

      <div className="relative z-10 w-full max-w-[56rem]">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate('/account')}
            className="group flex items-center gap-3 text-stone-500 hover:text-stone-900 transition-colors"
          >
            <div className="w-8 h-8 rounded-full border border-stone-200 flex items-center justify-center bg-white/50 backdrop-blur-md group-hover:bg-white transition-colors">
              <ArrowLeft size={14} strokeWidth={1.5} />
            </div>
            <span className="text-xs font-medium uppercase tracking-widest">Back to Account</span>
          </button>
        </div>

        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <Gift size={28} className="text-amber-600" />
            Affiliate Dashboard
          </h1>
          <p className="text-stone-500 mt-2">Track your commissions and earnings</p>
        </div>

        {/* Affiliate Info Card */}
        <section className="bg-white rounded-3xl p-8 mb-6 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            {/* Referral Code */}
            <div className="flex-1">
              <label className="text-xs font-medium text-stone-500 uppercase tracking-wider">Your Referral Code</label>
              <div className="flex items-center gap-3 mt-2">
                <div className="px-4 py-3 bg-stone-50 rounded-xl border border-stone-200 font-mono text-xl font-semibold text-stone-900">
                  {affiliate.code}
                </div>
                <button
                  onClick={handleCopyCode}
                  className="p-3 rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors"
                  title="Copy code"
                >
                  {copied ? (
                    <Check size={20} className="text-green-600" />
                  ) : (
                    <Copy size={20} className="text-stone-500" />
                  )}
                </button>
              </div>
            </div>

            {/* Commission Rate */}
            <div className="text-right">
              <label className="text-xs font-medium text-stone-500 uppercase tracking-wider">Commission Rate</label>
              <div className="text-3xl font-bold text-stone-900 mt-1">
                {Math.round(affiliate.commission_rate * 100)}%
              </div>
            </div>
          </div>
        </section>

        {/* Stats Cards */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={18} className="text-stone-500" />
              <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">Total Commission</span>
            </div>
            <div className="text-2xl font-bold text-stone-900">{formatCurrency(stats.totalCommission)}</div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={18} className="text-amber-500" />
              <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">Pending</span>
            </div>
            <div className="text-2xl font-bold text-amber-600">{formatCurrency(stats.pendingCommission)}</div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-5 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-green-200">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={18} className="text-green-600" />
              <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">Available</span>
            </div>
            <div className="text-2xl font-bold text-green-700">{formatCurrency(stats.availableToWithdraw)}</div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={18} className="text-stone-500" />
              <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">Paid Out</span>
            </div>
            <div className="text-2xl font-bold text-stone-900">{formatCurrency(stats.paidOut)}</div>
          </div>
        </section>

        {/* Additional Stats */}
        <section className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
              <ShoppingCart size={24} className="text-blue-600" />
            </div>
            <div>
              <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Total Purchases</div>
              <div className="text-2xl font-bold text-stone-900">{stats.totalPurchases}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center">
              <Users size={24} className="text-purple-600" />
            </div>
            <div>
              <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Total Buyers</div>
              <div className="text-2xl font-bold text-stone-900">{stats.totalBuyers}</div>
            </div>
          </div>
        </section>

        {/* Withdrawal Section */}
        <section className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-3xl p-8 mb-6 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-green-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-stone-900">Request Withdrawal</h3>
              <p className="text-sm text-stone-500 mt-1">
                {stats.availableToWithdraw > 0
                  ? `You have ${formatCurrency(stats.availableToWithdraw)} available to withdraw`
                  : 'No balance available for withdrawal'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {currentWithdrawal ? (
                <div className="px-5 py-2.5 bg-amber-100 text-amber-800 text-sm font-medium rounded-xl">
                  Withdrawal Requested
                </div>
              ) : stats.availableToWithdraw > 0 ? (
                <button
                  onClick={handleWithdraw}
                  disabled={withdrawing}
                  className="px-6 py-2.5 bg-stone-900 text-white text-sm font-medium rounded-xl hover:bg-stone-800 transition-colors disabled:opacity-50"
                >
                  {withdrawing ? 'Processing...' : 'Request Withdrawal'}
                </button>
              ) : (
                <div className="px-5 py-2.5 bg-stone-100 text-stone-500 text-sm font-medium rounded-xl">
                  No Available Balance
                </div>
              )}
              {withdrawMessage && (
                <p className="text-sm text-stone-600 text-right">{withdrawMessage}</p>
              )}
            </div>
          </div>
        </section>

        {/* Purchase History Table */}
        <section className="bg-white rounded-3xl p-8 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <h3 className="text-lg font-semibold text-stone-900 mb-6">Purchase History</h3>

          {purchases.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart size={48} className="text-stone-300 mx-auto mb-4" />
              <p className="text-stone-500">No purchases yet</p>
              <p className="text-sm text-stone-400 mt-1">Share your code to start earning commissions</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className="text-left py-3 px-4 text-xs font-medium text-stone-500 uppercase tracking-wider">Buyer</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-stone-500 uppercase tracking-wider">Plan</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-stone-500 uppercase tracking-wider">Amount</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-stone-500 uppercase tracking-wider">Commission</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-stone-500 uppercase tracking-wider">Date</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-stone-500 uppercase tracking-wider">Available</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-stone-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((purchase) => {
                    const statusBadge = getStatusBadge(purchase.status, purchase.eligible_at);
                    const daysLeft = getDaysLeft(purchase.eligible_at);
                    
                    return (
                      <tr key={purchase.id} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="py-3 px-4 text-sm text-stone-700">
                          {purchase.buyer_email || 'Unknown'}
                        </td>
                        <td className="py-3 px-4 text-sm text-stone-700">
                          {getPlanLabel(purchase.plan_key)}
                        </td>
                        <td className="py-3 px-4 text-sm text-stone-700 text-right">
                          {formatCurrency(purchase.purchase_amount)}
                        </td>
                        <td className="py-3 px-4 text-sm font-medium text-green-700 text-right">
                          {formatCurrency(purchase.commission_amount)}
                        </td>
                        <td className="py-3 px-4 text-sm text-stone-600">
                          {formatDate(purchase.created_at)}
                        </td>
                        <td className="py-3 px-4 text-sm text-stone-600">
                          {daysLeft > 0 ? `${daysLeft}d left` : 'Now'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${statusBadge.bg} ${statusBadge.text}`}>
                            {statusBadge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Footer */}
        <div className="text-center pt-8 pb-4">
          <p className="text-xs text-stone-400 font-medium">
            Commissions are eligible for withdrawal 30 days after purchase
          </p>
        </div>
      </div>
    </div>
  );
}
