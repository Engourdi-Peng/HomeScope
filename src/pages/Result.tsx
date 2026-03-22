import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../types';
import { ResultCard } from '../components/ResultCard';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { shareAnalysis } from '../lib/api';

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

  const handleShare = async (analysisId: string) => {
    if (!analysisId) {
      throw new Error('Analysis ID not found');
    }
    return (await shareAnalysis(analysisId)).shareUrl;
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
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
      {/* Background Elements */}
      <div className="fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply pointer-events-none overflow-hidden">
        <img 
          src="https://images.unsplash.com/photo-1720442617080-c25f9955194c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtaW5pbWFsaXN0JTIwbW9kZXJuJTIwaG91c2UlMjBleHRlcmlvciUyMGFyY2hpdGVjdHVyZSUyMHdoaXRlfGVufDF8fHx8MTc3MzE5ODI5NHww&ixlib=rb-4.1.0&q=80&w=1080" 
          alt="Modern architecture" 
          className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale" 
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent"></div>
      </div>

      <div className="relative z-10 w-full max-w-[56rem]">
        <ResultCard 
          result={result} 
          onBack={() => navigate('/')} 
          onShare={isAuthenticated ? handleShare : undefined}
        />
      </div>
    </div>
  );
}
