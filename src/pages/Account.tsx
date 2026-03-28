import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAnalysisHistory, getAnalysisById } from '../lib/api';
import type { AnalysisSummary, AnalysisResult, ListingInfo } from '../types';
import { User, Sparkles, Clock, ChevronRight, ChevronLeft, LogOut, AlertCircle, RefreshCw, RefreshCcw, FileText, Shield, Mail, ArrowLeft } from 'lucide-react';

export function AccountPage() {
  const navigate = useNavigate();
  const { user, profile, isAuthenticated, signOut, creditsRemaining, isLoading: authLoading } = useAuth();
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAnalysisDate, setLastAnalysisDate] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/');
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Fetch analysis history
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchHistory = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const history = await getAnalysisHistory(20, 0);
        // Filter out failed analyses
        const successfulHistory = history.filter(a => a.status !== 'failed');
        setAnalyses(successfulHistory);

        // Get last analysis date
        if (successfulHistory.length > 0) {
          const lastAnalysis = history.find(a => a.status === 'done');
          if (lastAnalysis) {
            setLastAnalysisDate(lastAnalysis.created_at);
          }
        }
      } catch (err) {
        console.error('Failed to fetch history:', err);
        setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, [isAuthenticated]);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleAnalysisClick = async (analysis: AnalysisSummary) => {
    if (analysis.status !== 'done') return;

    try {
      // If we have full result, use it; otherwise fetch from API
      let result = analysis.full_result;
      if (!result) {
        const fullAnalysis = await getAnalysisById(analysis.id);
        result = fullAnalysis.full_result;
      }

      if (result) {
        result.id = analysis.id;

        // Inject listingInfo from analysis metadata (same as Share.tsx)
        const listingInfo: ListingInfo = {
          title: analysis.title || undefined,
          address: analysis.address || undefined,
          coverImageUrl: analysis.cover_image_url || undefined,
          priceAmount: analysis.weekly_rent || undefined,
          bedrooms: analysis.bedrooms || undefined,
          bathrooms: analysis.bathrooms || undefined,
          carSpaces: analysis.car_spaces || undefined,
        };
        (result as AnalysisResult & { listingInfo: ListingInfo }).listingInfo = listingInfo;

        sessionStorage.setItem('analysisResult', JSON.stringify(result));
        navigate('/result');
      }
    } catch (err) {
      console.error('Failed to load analysis:', err);
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

  const getScoreColor = (score?: number) => {
    if (!score) return 'text-stone-400';
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'done':
        return { bg: 'bg-green-50', text: 'text-green-700', label: 'Completed' };
      case 'processing':
        return { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Processing' };
      case 'failed':
        return { bg: 'bg-red-50', text: 'text-red-700', label: 'Failed' };
      default:
        return { bg: 'bg-stone-50', text: 'text-stone-700', label: 'Pending' };
    }
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

  return (
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-12 px-4 sm:px-6 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply pointer-events-none overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1720442617080-c25f9955194c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHptaW5pbWFsaXN0JTIwbW9kZXJuJTIwaG91c2UlMjBleHRlcmlvciUyMGFyY2hpdGVjdHVyZSUyMHdoaXRlfGVufDF8fHx8MTc3MzE5ODI5NHww&ixlib=rb-4.1.0&q=80&w=1080"
          alt="Modern architecture"
          className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent"></div>
      </div>

      <div className="relative z-10 w-full max-w-[56rem]">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate('/')}
            className="group flex items-center gap-3 text-stone-500 hover:text-stone-900 transition-colors"
          >
            <div className="w-8 h-8 rounded-full border border-stone-200 flex items-center justify-center bg-white/50 backdrop-blur-md group-hover:bg-white transition-colors">
              <ArrowLeft size={14} strokeWidth={1.5} />
            </div>
            <span className="text-xs font-medium uppercase tracking-widest">Back to Home</span>
          </button>
        </div>

        {/* Section 1: Profile */}
        <section className="bg-white rounded-3xl p-8 mb-6 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Avatar"
                  className="w-16 h-16 rounded-full"
                />
              ) : (
                <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center">
                  <User size={32} className="text-stone-400" />
                </div>
              )}
              <div>
                <h2 className="text-xl font-semibold text-stone-900">
                  {user?.user_metadata?.name || user?.email?.split('@')[0] || 'User'}
                </h2>
                <p className="text-stone-500 text-sm">{user?.email}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                className="px-4 py-2 bg-stone-900 text-white text-sm font-medium rounded-xl hover:bg-stone-800 transition-colors"
                onClick={() => navigate('/pricing')}
              >
                Buy Credits
              </button>
            </div>
          </div>
        </section>

        {/* Section 2: Usage */}
        <section className="bg-white rounded-3xl p-8 mb-6 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <h3 className="text-lg font-semibold text-stone-900 mb-6">Usage</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={16} className="text-amber-600" />
                <span className="text-xs font-medium text-amber-700">Credits Remaining</span>
              </div>
              <div className="text-3xl font-semibold text-amber-800">{creditsRemaining}</div>
            </div>
            <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={16} className="text-stone-600" />
                <span className="text-xs font-medium text-stone-600">Total Used</span>
              </div>
              <div className="text-3xl font-semibold text-stone-800">{profile?.credits_used || 0}</div>
            </div>
            <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={16} className="text-stone-600" />
                <span className="text-xs font-medium text-stone-600">Last Analysis</span>
              </div>
              <div className="text-lg font-semibold text-stone-800">
                {lastAnalysisDate ? formatDate(lastAnalysisDate) : 'N/A'}
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Recent Analyses */}
        <section className="bg-white rounded-3xl p-8 mb-6 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <h3 className="text-lg font-semibold text-stone-900 mb-6">Recent Analyses</h3>

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-stone-300 border-t-stone-600 rounded-full"></div>
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle size={32} className="text-red-500 mb-3" />
              <p className="text-stone-600 mb-4">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-700 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors"
              >
                <RefreshCw size={16} />
                Click to retry
              </button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && analyses.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText size={48} className="text-stone-300 mb-4" />
              <p className="text-stone-600 mb-2">No analyses yet</p>
              <p className="text-stone-500 text-sm mb-6">Start your first analysis to see it here!</p>
              <button
                onClick={() => navigate('/')}
                className="px-6 py-2 bg-stone-900 text-white text-sm font-medium rounded-xl hover:bg-stone-800 transition-colors"
              >
                Start Analyzing
              </button>
            </div>
          )}

          {/* Analysis List */}
          {!isLoading && !error && analyses.length > 0 && (
            <div className="space-y-3">
              {analyses
                .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                .map((analysis) => {
                const statusBadge = getStatusBadge(analysis.status);
                return (
                  <div
                    key={analysis.id}
                    onClick={() => handleAnalysisClick(analysis)}
                    className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                      analysis.status === 'done'
                        ? 'border-stone-200 hover:border-black cursor-pointer bg-white'
                        : 'border-stone-100 bg-stone-50 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    {/* Cover Image */}
                    <div className="w-16 h-16 rounded-xl bg-stone-100 overflow-hidden shrink-0">
                      {analysis.cover_image_url ? (
                        <img
                          src={analysis.cover_image_url}
                          alt="Cover"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <FileText size={24} className="text-stone-300" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-stone-900 truncate">
                          {analysis.title || 'Property Analysis'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge.bg} ${statusBadge.text}`}>
                          {statusBadge.label}
                        </span>
                      </div>
                      {analysis.address && (
                        <p className="text-sm text-stone-500 truncate">{analysis.address}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-stone-500">
                        <span>{formatDate(analysis.created_at)}</span>
                        {analysis.overall_score !== undefined && analysis.status === 'done' && (
                          <span className={`font-semibold ${getScoreColor(analysis.overall_score)}`}>
                            Score: {analysis.overall_score}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Arrow */}
                    {analysis.status === 'done' && (
                      <ChevronRight size={20} className="text-stone-400 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {analyses.length > itemsPerPage && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-stone-200">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-600 hover:text-stone-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <div className="flex items-center gap-2">
                {Array.from({ length: Math.ceil(analyses.length / itemsPerPage) }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === page
                        ? 'bg-stone-900 text-white'
                        : 'text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage(p => Math.min(Math.ceil(analyses.length / itemsPerPage), p + 1))}
                disabled={currentPage >= Math.ceil(analyses.length / itemsPerPage)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-600 hover:text-stone-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </section>

        {/* Section 4: Support / Settings */}
        <section className="bg-white rounded-3xl p-8 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <h3 className="text-lg font-semibold text-stone-900 mb-6">Support & Settings</h3>
          <div className="space-y-3">
            <Link
              to="/privacy"
              className="flex items-center justify-between p-3 rounded-xl hover:bg-stone-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Shield size={18} className="text-stone-500" />
                <span className="text-stone-700">Privacy Policy</span>
              </div>
              <ChevronRight size={18} className="text-stone-400" />
            </Link>
            <Link
              to="/terms"
              className="flex items-center justify-between p-3 rounded-xl hover:bg-stone-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-stone-500" />
                <span className="text-stone-700">Terms of Service</span>
              </div>
              <ChevronRight size={18} className="text-stone-400" />
            </Link>
            <Link
              to="/refund"
              className="flex items-center justify-between p-3 rounded-xl hover:bg-stone-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <RefreshCcw size={18} className="text-stone-500" />
                <span className="text-stone-700">Refund Policy</span>
              </div>
              <ChevronRight size={18} className="text-stone-400" />
            </Link>
            <a
              href="mailto:a472018670@gmail.com"
              className="flex items-center justify-between p-3 rounded-xl hover:bg-stone-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Mail size={18} className="text-stone-500" />
                <span className="text-stone-700">Contact Support</span>
              </div>
              <ChevronRight size={18} className="text-stone-400" />
            </a>
            <button
              onClick={handleSignOut}
              className="flex items-center justify-between w-full p-3 rounded-xl hover:bg-red-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <LogOut size={18} className="text-stone-500 group-hover:text-red-600" />
                <span className="text-stone-700 group-hover:text-red-700">Sign Out</span>
              </div>
              <ChevronRight size={18} className="text-stone-400 group-hover:text-red-500" />
            </button>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center pt-8 pb-4">
          <p className="text-xs text-stone-400 font-medium">
            AI Rental Decision Assistant
          </p>
        </div>
      </div>
    </div>
  );
}
