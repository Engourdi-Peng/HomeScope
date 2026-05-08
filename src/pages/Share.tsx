import { useEffect, useState } from 'react';
import type { AnalysisResult, AnalysisSummary, ListingInfo } from '../types';
import { ResultCard } from '../components/ResultCard';
import { useNavigate, useParams } from 'react-router-dom';
import { getPublicAnalysis } from '../lib/api';
import { usePublicPageSEO } from '../hooks/useSEOMeta';
import { generateSEOContentBlock, extractSuburbFromAddress } from '../lib/seo-utils';

const BASE_URL = 'https://www.tryhomescope.com';

export function SharePage() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisSummary | null>(null);
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

        // Store full analysis data including SEO fields
        setAnalysisData(analysis);

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

        // Override reportMode from database (source of truth)
        transformedResult.reportMode = (analysis as any).report_mode || 
          transformedResult.reportMode || 
          'rent';

        // Build listingInfo from analysis data
        const listingInfo: ListingInfo = {
          title: analysis.title || undefined,
          address: analysis.address || undefined,
          coverImageUrl: analysis.cover_image_url || undefined,
        };

        // Add to transformed result
        (transformedResult as AnalysisResult & { listingInfo: ListingInfo }).listingInfo = listingInfo;

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

  // 从地址中提取 suburb
  const suburb = extractSuburbFromAddress(analysisData?.address);

  // 获取 bedrooms 数量
  const bedrooms = result?.roomCounts?.bedrooms || result?.roomCounts?.bedroom || null;

  // 获取 reportMode 用于区分租赁/购房
  const reportMode = result?.reportMode || 'rent';

  // 动态生成 SEO title（区分租赁和购房）
  const seoTitle = reportMode === 'sale'
    ? (suburb && bedrooms
        ? `${bedrooms} bed property on realestate.com.au in ${suburb} – Worth buying?`
        : suburb
          ? `Property on realestate.com.au in ${suburb} – Worth buying?`
          : 'realestate.com.au Property Analysis – Worth buying?')
    : (suburb && bedrooms
        ? `${bedrooms} bed rental on realestate.com.au in ${suburb} – Worth it?`
        : suburb
          ? `Rental on realestate.com.au in ${suburb} – Worth it?`
          : 'realestate.com.au Rental Analysis – Worth it?');

  // 动态生成 SEO description
  const seoDescription = suburb && bedrooms
    ? `${bedrooms}-bed, ${result?.roomCounts?.bathrooms || '?'}-bath on realestate.com.au in ${suburb}. ${analysisData?.rent_price ? `$${analysisData.rent_price}/week. ` : ''}AI analysis: pros, cons, risks and verdict. Built for Australian renters.`
    : bedrooms
      ? `${bedrooms}-bed property on realestate.com.au. AI analysis: pros, cons, risks and verdict. Built for Australian renters.`
      : 'AI analysis of property from realestate.com.au. Pros, cons, risks and verdict. Built for Australian renters.';

  // 设置公开分享页 SEO（index, follow, canonical, OG）
  usePublicPageSEO(seoTitle, seoDescription, slug || '');

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

  // Generate SEO content block for the bottom of the page
  const seoContentBlock = result ? generateSEOContentBlock({
    suburb: suburb,
    bedrooms: bedrooms,
    whatLooksGood: result.whatLooksGood || [],
    riskSignals: result.riskSignals || [],
    verdict: result.verdict || null,
    quickSummary: result.quickSummary || null,
  }) : '';

  return (
    <>
      {/* Structured Data for Google */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": seoTitle,
          "description": seoDescription,
          "datePublished": analysisData?.created_at,
          "dateModified": analysisData?.updated_at,
          "author": {
            "@type": "Organization",
            "name": "HomeScope"
          },
          "publisher": {
            "@type": "Organization",
            "name": "HomeScope",
            "url": BASE_URL
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
            isPublicShare={true}
          />

          {/* SEO Content Block - 仅在公开分享页显示 */}
          {seoContentBlock && (
            <div className="mt-12 p-6 bg-white/50 backdrop-blur-sm rounded-xl border border-stone-200">
              <div className="prose prose-stone prose-sm max-w-none">
                {seoContentBlock.split('\n').map((line, index) => {
                  if (line.startsWith('## ')) {
                    return <h2 key={index} className="text-lg font-semibold text-stone-900 mt-6 mb-3">{line.replace('## ', '')}</h2>;
                  }
                  if (line.startsWith('### ')) {
                    return <h3 key={index} className="text-md font-medium text-stone-800 mt-4 mb-2">{line.replace('### ', '')}</h3>;
                  }
                  if (line.startsWith('- ')) {
                    return <li key={index} className="text-stone-700 ml-4">{line.replace('- ', '')}</li>;
                  }
                  if (line.trim()) {
                    return <p key={index} className="text-stone-600 mb-2">{line}</p>;
                  }
                  return null;
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
