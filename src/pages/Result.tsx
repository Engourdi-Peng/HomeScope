import { useEffect, useState } from 'react';
import type { AnalysisResult, BasicAnalysisResult } from '../types';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { shareAnalysis } from '../lib/api';
import { ReportScreen } from '../shared/report/ReportScreen';
import { usePrivatePageSEO } from '../hooks/useSEOMeta';

function loadFromSession() {
  try {
    const stored = sessionStorage.getItem('analysisResult');
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user } = useAuth();
  const [result, setResult] = useState<AnalysisResult | BasicAnalysisResult | null>(null);

  // 私密报告页：设置 noindex, nofollow
  usePrivatePageSEO();

  // 主读取：location.search (rid) 变化时重新读取 sessionStorage
  const rid = new URLSearchParams(location.search).get('rid');

  useEffect(() => {
    const parsed = loadFromSession();
    if (parsed) {
      setResult(parsed);
      const storedVersion = sessionStorage.getItem('analysisResultVersion') || '';
      console.log('[HS RESULT LOAD]', {
        rid,
        storedVersion,
        address: (parsed as any)?.listingInfo?.address ?? (parsed as any)?.address,
        title: (parsed as any)?.listingInfo?.title ?? (parsed as any)?.title,
      });
    }
  }, [rid]);

  // 补充：同 tab 自定义事件（当 navigation 已经发生时）
  useEffect(() => {
    const handler = () => {
      const parsed = loadFromSession();
      if (parsed) {
        setResult(parsed);
        const storedVersion = sessionStorage.getItem('analysisResultVersion') || '';
        console.log('[HS RESULT LOAD (event)]', {
          rid: new URLSearchParams(location.search).get('rid'),
          storedVersion,
        });
      }
    };
    window.addEventListener('homescope:analysis-result-updated', handler);
    return () => window.removeEventListener('homescope:analysis-result-updated', handler);
  }, [location.search]);

  const handleBack = () => {
    sessionStorage.removeItem('analysisResult');
    sessionStorage.removeItem('analysisResultVersion');
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
    const shareResult = await shareAnalysis(analysisId);
    return { slug: shareResult.slug, shareUrl: shareResult.shareUrl };
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
      analysisId={getAnalysisId()}
      userId={user?.id}
    />
  );
}
