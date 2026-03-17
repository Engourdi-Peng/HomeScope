import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../types';
import { ResultCard } from '../components/ResultCard';
import { useNavigate, useParams } from 'react-router-dom';
import { getPublicAnalysis } from '../lib/api';

export function SharePage() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setError('Missing share link');
      setLoading(false);
      return;
    }

    const fetchPublicAnalysis = async () => {
      try {
        const analysis = await getPublicAnalysis(slug);
        if (!analysis) {
          setError('Analysis not found');
          return;
        }

        // Get full result if available, otherwise build from summary
        const fullResult = analysis.full_result as AnalysisResult | undefined;

        // Build basic result from stored summary with required fields
        const requiredFields: AnalysisResult = {
          overallScore: analysis.overall_score || 0,
          verdict: (analysis.verdict as AnalysisResult['verdict']) || 'Need More Evidence',
          quickSummary: analysis.summary?.quickSummary || analysis.verdict || '',
          whatLooksGood: analysis.summary?.whatLooksGood || [],
          riskSignals: analysis.summary?.riskSignals || [],
          realityCheck: '',
          questionsToAsk: [],
          decisionPriority: 'MEDIUM',
          confidenceLevel: 'Medium',
        };

        // Use full result if available, otherwise use required fields
        const transformedResult: AnalysisResult = fullResult 
          ? { ...requiredFields, ...fullResult }
          : requiredFields;

        setResult(transformedResult);
      } catch (err) {
        console.error('Failed to fetch public analysis:', err);
        setError('Analysis not found or link is invalid');
      } finally {
        setLoading(false);
      }
    };

    fetchPublicAnalysis();
  }, [slug]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-800 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-stone-600">Loading shared analysis...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !result) {
    return (
      <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-stone-900 mb-2">Link Invalid or Expired</h2>
          <p className="text-stone-600 mb-4">{error || 'This shared analysis does not exist or has been removed.'}</p>
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

  // SEO Meta tags
  const seoTitle = `HomeScope Analysis: ${result.overallScore}/100 - ${result.verdict}`;
  const seoDescription = result.quickSummary 
    ? `${result.quickSummary.slice(0, 150)}${result.quickSummary.length > 150 ? '...' : ''}`
    : `Property analysis result with score ${result.overallScore}/100`;

  return (
    <>
      {/* SEO Meta Tags */}
      <title>{seoTitle}</title>
      <meta name="description" content={seoDescription} />
      <meta property="og:title" content={seoTitle} />
      <meta property="og:description" content={seoDescription} />
      <meta property="og:type" content="website" />
      
      {/* Structured Data for Google */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "HomeScope Property Analysis",
          "description": seoDescription,
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": result.overallScore,
            "bestRating": 100,
            "worstRating": 0,
            "ratingCount": 1
          }
        })}
      </script>

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
          />
        </div>
      </div>
    </>
  );
}
