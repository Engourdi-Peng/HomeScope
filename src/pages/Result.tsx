import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { shareAnalysis } from '../lib/api';
import { ReportScreen } from '../shared/report/ReportScreen';

export function ResultPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [result, setResult] = useState<AnalysisResult | null>(null);

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
    navigate('/');
  };

  const handleShare = async (analysisId: string) => {
    if (!analysisId) {
      throw new Error('Analysis ID not found');
    }
    const shareResult = await shareAnalysis(analysisId);
    return { slug: shareResult.slug, shareUrl: shareResult.shareUrl };
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
    />
  );
}
