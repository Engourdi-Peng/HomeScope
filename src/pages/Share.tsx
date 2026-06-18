import { useEffect, useState } from 'react';
import type { AnalysisResult, AnalysisSummary, ListingInfo } from '../types';
import { useNavigate, useParams } from 'react-router-dom';
import { getPublicAnalysis } from '../lib/api';
import { usePublicPageSEO } from '../hooks/useSEOMeta';
import { ReportScreen } from '../shared/report/ReportScreen';

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
  const suburb = analysisData?.address
    ? analysisData.address.split(',').pop()?.trim() || analysisData.address
    : null;

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

  const handleBack = () => {
    navigate('/');
  };

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

      {/* 使用新版 ReportScreen 组件渲染 */}
      <ReportScreen
        mode="web"
        result={result}
        onBack={handleBack}
        analysisId={result.id}
        // 分享页不需要分享功能
        onShare={undefined}
        // 分享页不需要升级功能
        onUpgrade={undefined}
        // 分享页不需要登录相关功能
        authStatus="logged_out"
        credits={0}
      />
    </>
  );
}
