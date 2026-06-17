import { useEffect, useState } from 'react';
import type { AnalysisResult, BasicAnalysisResult } from '../types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { shareAnalysis } from '../lib/api';
import { ReportScreen } from '../shared/report/ReportScreen';
import { usePrivatePageSEO } from '../hooks/useSEOMeta';

export function ResultPage() {
  const navigate = useNavigate();
  const { isAuthenticated, creditsRemaining, signInWithGoogle } = useAuth();
  const [result, setResult] = useState<AnalysisResult | BasicAnalysisResult | null>(null);
  const [shareState, setShareState] = useState<{
    shareResult: { slug: string; shareUrl: string } | null;
    copied: boolean;
    isSharing: boolean;
  }>({ shareResult: null, copied: false, isSharing: false });

  // 私密报告页：设置 noindex, nofollow
  usePrivatePageSEO();

  useEffect(() => {
    const stored = sessionStorage.getItem('analysisResult');
    if (stored) {
      try {
        setResult(JSON.parse(stored));
      } catch {
        // Invalid data
      }
    }
  }, []);

  const handleBack = () => {
    sessionStorage.removeItem('analysisResult');
    // 返回上一页，如果无法返回则跳转首页
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleShare = async (analysisId: string) => {
    if (!analysisId) {
      throw new Error('Analysis ID not found');
    }
    setShareState({ shareResult: null, isSharing: true, copied: false });
    try {
      const shareResult = await shareAnalysis(analysisId);
      setShareState({ shareResult: { slug: shareResult.slug, shareUrl: shareResult.shareUrl }, copied: false, isSharing: false });
      return { slug: shareResult.slug, shareUrl: shareResult.shareUrl };
    } catch (err) {
      setShareState(prev => ({ ...prev, isSharing: false }));
      throw err;
    }
  };

  // Handle upgrade from basic to full analysis
  const handleUpgrade = () => {
    if (!isAuthenticated) {
      // Redirect to home page which has login flow
      navigate('/?login=true');
    } else if (creditsRemaining <= 0) {
      // Redirect to account page for purchasing credits
      navigate('/account');
    }
    // If authenticated with credits, the onUpgrade would need to trigger full analysis
    // For web mode, this would typically redirect to home with full analysis request
  };

  // Sign-in handler for the upsell CTA
  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign in failed:', error);
    }
  };

  // Checkout handler for purchasing credits
  const handleOpenCheckout = () => {
    navigate('/account');
  };

  // For basic analysis, we don't have a direct ID from the session storage
  const getAnalysisId = (): string | undefined => {
    if (result && 'id' in result) {
      return result.id;
    }
    return undefined;
  };

  if (!result) {
    return (
      <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-stone-900 mb-2">No Analysis Found</h2>
          <p className="text-stone-600 mb-4">Please analyze a property first.</p>
          <button
            onClick={() => navigate('/')}
            className="text-stone-800 hover:underline"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <ReportScreen
      mode="web"
      result={result}
      onBack={handleBack}
      onShare={isAuthenticated ? handleShare : undefined}
      onUpgrade={handleUpgrade}
      analysisId={getAnalysisId()}
      shareState={shareState}
      authStatus={isAuthenticated ? 'logged_in' : 'logged_out'}
      credits={creditsRemaining}
      onSignIn={handleSignIn}
      onOpenCheckout={handleOpenCheckout}
    />
  );
}
