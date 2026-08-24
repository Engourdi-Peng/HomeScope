import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { InputCard } from '../components/InputCard';
import type { AnalysisStage, Photo, OptionalDetails } from '../types';
import { submitAnalysis, runAnalysis, compressImageForUpload, uploadImagesToStorage, getAnalysisProgress, analyzeBasicSync } from '../lib/api';
import { Sparkles, Camera, FileText, LayoutGrid, AlertTriangle, TrendingUp, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { FAQItem } from '../components/FAQItem';
import { PricingCard } from '../components/PricingCard';
import { ListingAnalysisSection } from '../components/ListingAnalysisSection';
import { ExtensionPromo } from '../components/ExtensionPromo';
import { PurchaseModal } from '../components/PurchaseModal';
import { SiteLayout } from '../components/SiteLayout';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import * as Accordion from '@radix-ui/react-accordion';

// 产品配置
const PRODUCTS = [
  {
    id: 'starter',
    title: 'Starter',
    price: '$6.99',
    reportCount: 5,
    description: 'Best for checking a few serious options before you spend time on a showing.',
    features: [
      'Full listing risk review',
      'Photo & condition review',
      'Price confidence & hidden-cost signals',
      'Questions to ask before you tour',
    ],
    buttonText: 'Get 5 Reports',
    isPopular: false,
  },
  {
    id: 'standard',
    title: 'Standard',
    price: '$15.99',
    reportCount: 12,
    description: 'Best for comparing homes and narrowing down your shortlist.',
    features: [
      'Complete Full Property Report for every listing',
      'Compare up to 12 properties',
      'Save reports for later review',
      'Shareable report links',
    ],
    buttonText: 'Get 12 Reports',
    isPopular: true,
  },
  {
    id: 'pro',
    title: 'Pro',
    price: '$39.99',
    reportCount: 35,
    description: 'Best for active buyers reviewing listings throughout a serious home search.',
    features: [
      'Complete Full Property Report for every listing',
      'Compare up to 35 properties',
      'Lowest cost per report',
      'Save and share every report',
    ],
    buttonText: 'Get 35 Reports',
    isPopular: false,
  },
];

export function Home() {
  const navigate = useNavigate();
  const { user, isAuthenticated, creditsRemaining, refreshProfile } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [description, setDescription] = useState('');
  const [optionalDetails, setOptionalDetails] = useState<OptionalDetails>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState('');
  const [activeStage, setActiveStage] = useState<AnalysisStage | null>(null);
  const [analyzingCount, setAnalyzingCount] = useState(0);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [progressLabel, setProgressLabel] = useState<string>('');
  const pollTimerRef = useRef<number | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<typeof PRODUCTS[0] | null>(null);

  const previewImages = [
    '/report-preview-1.png',
    '/report-preview-2.png',
    '/report-preview-3.png',
  ];

  const nextPreview = () => setPreviewIndex((prev) => (prev + 1) % previewImages.length);
  const prevPreview = () => setPreviewIndex((prev) => (prev - 1 + previewImages.length) % previewImages.length);

  const handleSelectProduct = (productId: string) => {
    // 1. 检查登录状态
    if (!isAuthenticated || !user) {
      setIsLoginModalOpen(true);
      return;
    }

    // 2. 打开购买确认 modal
    const product = PRODUCTS.find(p => p.id === productId);
    if (product) {
      setSelectedProduct(product);
    }
  };

  const handlePurchaseModalClose = () => {
    setSelectedProduct(null);
  };

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const stageToPct = (stage: AnalysisStage | null): number => {
    if (!stage) return 0;
    const mapping: Record<AnalysisStage, number> = {
      upload_received: 10,
      detecting_rooms: 30,
      evaluating_spaces: 45,
      extracting_strengths_and_issues: 65,
      estimating_competition: 80,
      building_final_report: 92,
      done: 100,
      failed: 100,
    };
    return mapping[stage] ?? 0;
  };

  useEffect(() => {
    return () => {
      clearPollTimer();
    };
  }, []);

  // ========== 轻量化 Basic Analysis ==========
  // 无需登录、无需图片、同步直接返回结果
  const handleBasicAnalysis = async () => {
    // 1. 权限检查 - 无需登录，任何人都可以使用
    // 注意：basic 分析不需要登录

    // 2. 数据验证
    if (!description.trim()) {
      setError('Please enter a listing description for basic analysis.');
      return;
    }

    setIsLoading(true);
    setError('');
    setProgressLabel('Analyzing listing...');
    setProgressPct(10);

    try {
      // 3. 直接调用同步 API（无需上传图片）
      setProgressPct(50);
      const result = await analyzeBasicSync({
        reportMode: optionalDetails.reportMode || 'rent',
        description,
        optionalDetails: Object.keys(optionalDetails).length > 0 ? optionalDetails : undefined,
      });

      setProgressPct(100);

      // 4. 直接保存结果并跳转，无需轮询
      // 构建 listingInfo
      const isRent = (optionalDetails.reportMode || 'rent') === 'rent';
      const listingInfo = {
        title: optionalDetails.suburb ? `${optionalDetails.suburb}` : undefined,
        price: isRent
          ? optionalDetails.weeklyRent ? `$${optionalDetails.weeklyRent} per week` : undefined
          : optionalDetails.askingPrice ? `$${parseInt(optionalDetails.askingPrice.replace(/[^0-9]/g, ''), 10).toLocaleString()}` : undefined,
        priceAmount: isRent
          ? optionalDetails.weeklyRent ? parseInt(optionalDetails.weeklyRent, 10) : undefined
          : optionalDetails.askingPrice ? parseInt(optionalDetails.askingPrice.replace(/[^0-9]/g, ''), 10) : undefined,
        bedrooms: optionalDetails.bedrooms ? parseInt(optionalDetails.bedrooms, 10) : undefined,
        bathrooms: optionalDetails.bathrooms ? parseInt(optionalDetails.bathrooms, 10) : undefined,
        parking: optionalDetails.parking ? parseInt(optionalDetails.parking, 10) : undefined,
      };

      const resultWithListingInfo = {
        ...result,
        listingInfo,
      };

      // Clear any previous listing's cached result before writing the new one
      // so a half-loaded /result tab from a prior listing cannot render stale data.
      sessionStorage.removeItem('analysisResult');
      sessionStorage.setItem('analysisResult', JSON.stringify(resultWithListingInfo));

      setIsLoading(false);
      setIsComplete(true);

      // 5. 跳转到结果页
      setTimeout(() => {
        navigate('/result');
      }, 300);

    } catch (err) {
      console.error('[BasicAnalysis] Error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Basic analysis failed';
      setError(errorMessage);
      setIsLoading(false);
      setProgressPct(0);
      setProgressLabel('');
    }
  };

  const handleSubmit = async (analysisType: 'basic' | 'full' = 'full') => {
    // ========== Basic Analysis - 轻量路径 ==========
    if (analysisType === 'basic') {
      return handleBasicAnalysis();
    }

    // ========== Full Analysis - 完整路径 (需要积分) ==========
    // ========== 权限检查 ==========
    // 1. 未登录用户不能 Analyze
    if (!isAuthenticated) {
      setError('Please sign in first to analyze listings.');
      setIsLoginModalOpen(true);
      return;
    }

    // 2. 已登录但无可用积分 - 深度分析需要积分，基础分析不需要
    if (analysisType === 'full' && creditsRemaining <= 0) {
      setError('You\'ve used all credits. Use Basic Analysis for free!');
      return;
    }

    if (photos.length === 0 && description.trim() === '') {
      return;
    }

    setIsLoading(true);
    setError('');
    setAnalyzingCount(Math.min(photos.length, analysisType === 'basic' ? 4 : 10));
    setIsComplete(false);
    setActiveStage(null);
    setProgressPct(0);

    try {
      const photosToAnalyze = analysisType === 'basic'
        ? photos.slice(0, 4)
        : photos.slice(0, 10);

      // ========== Step 1: Compress images ==========
      setProgressLabel('Preparing photos...');
      const compressedFiles = [];
      for (let i = 0; i < photosToAnalyze.length; i++) {
        setProgressPct(Math.round(((i / Math.max(photosToAnalyze.length, 1)) * 30) || 0));
        setProgressLabel(`Preparing photos... (${i + 1}/${photosToAnalyze.length})`);
        // eslint-disable-next-line no-await-in-loop
        const compressed = await compressImageForUpload(photosToAnalyze[i].file);
        compressedFiles.push(compressed);
      }

      // ========== Step 2: Upload to Supabase Storage ==========
      setProgressPct(30);
      setProgressLabel('Uploading photos...');

      // Use batch upload for efficiency
      const uploadedFiles = compressedFiles.map(c => c.file);
      const imageUrls = await uploadImagesToStorage(uploadedFiles);

      // ========== Step 3: Build request with imageUrls ==========
      // If user did not paste a listingUrl, fall back to window.location.href
      // when the user is already on a known listing site (Zillow / Realtor /
      // Redfin). Otherwise leave empty. This helps Result.tsx cross-listing
      // guard and the "Open listing" navigation.
      const effectiveListingUrl = (() => {
        const explicit = (optionalDetails as any)?.listingUrl as string | undefined;
        if (explicit && explicit.trim()) return explicit.trim();
        if (typeof window === 'undefined') return undefined;
        try {
          const host = window.location.host.toLowerCase();
          if (/(zillow\.com|realtor\.com|redfin\.com|trulia\.com|homes\.com|compass\.com)/.test(host)) {
            return window.location.href;
          }
        } catch { /* ignore */ }
        return undefined;
      })();

      const requestData = {
        reportMode: optionalDetails.reportMode || 'rent',
        analysisType,
        imageUrls,
        description,
        optionalDetails: (() => {
          if (Object.keys(optionalDetails).length === 0) return undefined;
          return { ...optionalDetails, listingUrl: effectiveListingUrl };
        })(),
      };

      // ========== Step 4: Submit to create analysis ID ==========
      setProgressPct(60);
      setProgressLabel('Starting analysis...');

      const submitResult = await submitAnalysis(requestData);
      const analysisId = submitResult.id;

      // ========== Step 5: Trigger the analysis runner ==========
      setProgressLabel(analysisType === 'basic' ? 'Running basic analysis...' : 'Analyzing property...');
      setActiveStage('upload_received');
      setProgressPct(Math.max(65, stageToPct('upload_received')));

      // Fire the run request - it will process in background
      runAnalysis(analysisId, requestData).catch((runErr) => {
        console.error('Run analysis error:', runErr);
        // Continue polling - the backend might still process even if this fails
      });

      // ========== Step 6: Start polling for progress ==========
      const poll = async () => {
        try {
          const progress = await getAnalysisProgress(analysisId);

          setActiveStage(progress.stage);
          setProgressLabel(progress.message || 'Analyzing...');
          setProgressPct(progress.progress ?? stageToPct(progress.stage));

          if (progress.status === 'done' && progress.result) {
            // Build listingInfo from current form data for the report header
            const coverImageUrl = imageUrls.length > 0 ? imageUrls[0] : undefined;
            const isRent = (optionalDetails.reportMode || 'rent') === 'rent';
            const listingInfo = {
              title: optionalDetails.suburb ? `${optionalDetails.suburb}` : undefined,
              price: isRent
                ? optionalDetails.weeklyRent ? `$${optionalDetails.weeklyRent} per week` : undefined
                : optionalDetails.askingPrice ? `$${parseInt(optionalDetails.askingPrice.replace(/[^0-9]/g, ''), 10).toLocaleString()}` : undefined,
              priceAmount: isRent
                ? optionalDetails.weeklyRent ? parseInt(optionalDetails.weeklyRent, 10) : undefined
                : optionalDetails.askingPrice ? parseInt(optionalDetails.askingPrice.replace(/[^0-9]/g, ''), 10) : undefined,
              bedrooms: optionalDetails.bedrooms ? parseInt(optionalDetails.bedrooms, 10) : undefined,
              bathrooms: optionalDetails.bathrooms ? parseInt(optionalDetails.bathrooms, 10) : undefined,
              parking: optionalDetails.parking ? parseInt(optionalDetails.parking, 10) : undefined,
              coverImageUrl,
            };
            const resultWithListingInfo = {
              ...progress.result,
              // Persist the requested analysis mode into sessionStorage so that
              // /result → ReportScreen → NewReportUI can confirm it's a Full
              // report even when upstream polling/progress payloads don't
              // include analysisType.
              ...(progress.result && typeof progress.result === 'object'
                ? { analysisType: (progress.result as any).analysisType ?? analysisType }
                : { analysisType }),
              listingInfo,
            };
            // Clear stale cache from any previous listing before storing the new
            // result, so a half-loaded /result tab from a different listing
            // cannot accidentally render old listing data.
            sessionStorage.removeItem('analysisResult');
            sessionStorage.setItem('analysisResult', JSON.stringify(resultWithListingInfo));
            setIsComplete(true);
            setProgressPct(100);
            setProgressLabel('Analysis complete');
            clearPollTimer();
            // Refresh user profile to update credits display
            if (analysisType === 'full') {
              refreshProfile();
            }
            setTimeout(() => {
              navigate('/result');
            }, 500);
            return;
          }

          if (progress.status === 'failed') {
            throw new Error(progress.error || progress.message || 'Analysis failed');
          }

          // Continue polling
          pollTimerRef.current = window.setTimeout(poll, 1000);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to get analysis progress';
          setError(msg);
          setIsLoading(false);
          setIsComplete(false);
          setActiveStage(null);
          setProgressPct(0);
          setProgressLabel('');
          clearPollTimer();
        }
      };

      clearPollTimer();
      pollTimerRef.current = window.setTimeout(poll, 500);
      return;
    } catch (err) {
      // 打印完整错误对象以便调试
      console.error('=== handleSubmit Error ===');
      console.error('Error object:', err);
      console.error('Error message:', err instanceof Error ? err.message : String(err));
      console.error('Error stack:', err instanceof Error ? err.stack : 'N/A');

      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze listing';
      setError(errorMessage);
      setIsLoading(false);
      setIsComplete(false);
      setActiveStage(null);
      setProgressPct(0);
      setProgressLabel('');
      clearPollTimer();
    }
  };

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

      <SiteLayout>

        {/* 1. Hero */}
        <div className="text-center mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-stone-900 leading-[1.15] mb-4">
            Know What to Check Before You Tour.
          </h1>
          <p className="text-lg md:text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed font-light mb-2">
            HomeScope turns Zillow listings into buyer-focused risk reports — price signals, photo observations, carrying costs, and questions to ask the agent.
          </p>
          <p className="text-sm text-stone-500 max-w-lg mx-auto">
            Run a free Basic Check first. Unlock a Full Report when a property is worth a closer look.
          </p>
          <p className="text-xs text-stone-500 text-center mt-4 italic max-w-lg mx-auto">
            HomeScope is an independent AI tool. Not affiliated with Zillow, StreetEasy, or any real estate marketplace. Reports are for informational purposes only and are not home inspections, appraisals, legal advice, or financial advice.
          </p>
        </div>

        {/* Extension Promo */}
        <ExtensionPromo />

        {/* 2. Upload Tool - First Screen */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '100ms' }}>
          <div className="bg-white rounded-[2rem] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] border border-stone-200 p-8 md:p-12">
            <h2 className="text-xl font-semibold text-stone-900 mb-2 text-center">Paste a Listing or Upload Screenshots</h2>
            <p className="text-sm text-stone-500 text-center mb-8">
              Add a property listing, screenshots, or notes. HomeScope will turn them into a buyer-focused property report.
            </p>
            
            <InputCard
              photos={photos}
              onPhotosChange={setPhotos}
              description={description}
              onDescriptionChange={setDescription}
              optionalDetails={optionalDetails}
              onOptionalDetailsChange={setOptionalDetails}
              onSubmit={handleSubmit}
              onLoginClick={() => setIsLoginModalOpen(true)}
              isLoading={isLoading}
              isComplete={isComplete}
              activeStage={activeStage}
              analyzingCount={analyzingCount}
              progressPct={progressPct}
              progressLabel={progressLabel}
              creditsRemaining={creditsRemaining}
              isAuthenticated={isAuthenticated}
            />
            
            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-2xl">
                <div className="flex items-start gap-3">
                  <div className="text-red-600 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-red-700 text-sm font-medium">{error}</p>
                    {(error.includes('No credits remaining') || error.includes('used all credits')) && (
                      <button
                        onClick={() => {
                          navigate('/pricing');
                        }}
                        className="mt-3 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
                      >
                        Go to Pricing
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={`transition-all duration-500 ${isLoading ? 'opacity-35 blur-[0.5px] pointer-events-none select-none' : 'opacity-100'}`}>
        {/* 3. Don't Trust Listing Photos - Analysis Section */}
        <ListingAnalysisSection />

        {/* 3. How It Works */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '200ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-8">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <Camera size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">1. Open a Supported Listing</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                Open a Zillow property page or paste listing details into HomeScope. Add screenshots if you want extra photo context.
              </p>
            </div>
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <Sparkles size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">2. Run a Basic Check or Full Report</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                Start with a free Basic Check. Unlock a Full Report for deeper photo review, price confidence, carrying costs, and risk analysis.
              </p>
            </div>
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <FileText size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">3. Review Your Buyer Report</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                See the score, key risks, missing information, and questions to ask before viewing or making an offer.
              </p>
            </div>
          </div>
        </div>

        {/* 4. What You Get */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '300ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-8">What You Get</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-4 p-5 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                <LayoutGrid size={24} className="text-green-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Property Risk Score</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  A clear score that summarizes listing strength, risk level, and how much still needs verification.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle size={24} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Detect Hidden Listing Risks</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Spot missing information, weak evidence, dated systems, legal-use concerns, or exaggerated listing claims.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <TrendingUp size={24} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Price Confidence Check</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Understand whether the asking price needs comps, condition checks, or stronger evidence before you trust it.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <CheckCircle size={24} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Should You View It?</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Get a practical next step: keep it on your shortlist, ask more questions, or skip the showing.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 5. Report Preview - 报告预览模块 */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '350ms' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
              {/* 左侧：轮播图片 */}
              <div className="relative p-6 md:p-8">
                <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)]">
                  <img 
                    src={previewImages[previewIndex]} 
                    alt="Report preview" 
                    className="w-full h-full object-contain"
                  />
                  {/* 左右箭头 */}
                  <button 
                    onClick={prevPreview}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow-md flex items-center justify-center hover:bg-white transition-colors"
                    aria-label="Previous"
                  >
                    <ChevronLeft size={20} className="text-stone-700" />
                  </button>
                  <button 
                    onClick={nextPreview}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow-md flex items-center justify-center hover:bg-white transition-colors"
                    aria-label="Next"
                  >
                    <ChevronRight size={20} className="text-stone-700" />
                  </button>
                </div>
                {/* 底部圆点指示器 */}
                <div className="flex justify-center gap-2 mt-4">
                  {previewImages.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setPreviewIndex(idx)}
                      className={`w-2.5 h-2.5 rounded-full transition-colors ${
                        idx === previewIndex ? 'bg-amber-500' : 'bg-stone-300'
                      }`}
                      aria-label={`Go to slide ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>

              {/* 右侧：文案 */}
              <div className="p-6 md:p-10 flex flex-col justify-center">
                <h3 className="text-2xl font-semibold text-stone-900 mb-4">
                  See What You'll Get
                </h3>
                <p className="text-base text-stone-600 leading-relaxed mb-6">
                  A structured buyer report with scores, risks, photo insights, carrying costs, and agent questions.
                </p>
                <button
                  onClick={() => {
                    if (!isAuthenticated) {
                      setIsLoginModalOpen(true);
                    } else {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-stone-900 hover:bg-stone-800 text-white font-semibold px-6 py-3 transition-colors w-fit"
                >
                  Get 3 Free Full Reports
                </button>
              </div>
            </div>
        </div>

        {/* 4. Pricing */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
          <div className="text-center mb-10">
            <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-4">
              Spot Costly Risks Before You Fall for a Listing
            </h2>
            <p className="text-center text-stone-600 font-light mb-3 max-w-2xl mx-auto">
              Get an independent second look at listing details, photo signals, price confidence, and missing information before you book a showing.
            </p>
            <p className="text-center text-stone-700 text-sm font-medium mb-6 max-w-xl mx-auto">
              HomeScope doesn’t sell homes or earn a commission from the sale.
            </p>
            <p className="text-center text-stone-700 text-sm font-medium mb-8 max-w-xl mx-auto">
              Every plan includes the same complete Full Property Report. You're only choosing how many properties to review.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 max-w-5xl mx-auto">
            {PRODUCTS.map((product) => (
              <PricingCard
                key={product.id}
                title={product.title}
                price={product.price}
                reportCount={product.reportCount}
                description={product.description}
                features={product.features}
                buttonText={product.buttonText}
                isPopular={product.isPopular}
                onBuy={handleSelectProduct}
                productId={product.id}
              />
            ))}
          </div>
        </div>

        {/* 5. FAQ */}
        <div className="mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '400ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-[#a8a29e] mb-8">FAQ</h2>
          <Accordion.Root type="single" collapsible className="bg-[rgba(250,250,249,0.4)] border-[0.667px] border-solid border-[rgba(231,229,228,0.8)] rounded-[24px] px-6 max-w-5xl mx-auto">
            <FAQItem 
              value="analyze-listings"
              question="Can AI analyze Zillow property listings?"
              answer="Yes. HomeScope can analyze supported property listings and extract key details such as price, beds, baths, square footage, year built, taxes, monthly payment estimates, listing claims, and available photos. It then turns those details into a buyer-focused risk report."
            />
            <FAQItem 
              value="evaluate-property"
              question="How should I evaluate a home before booking a showing?"
              answer="Before booking a showing, check the asking price, comparable sales, property age, roof and major systems, permits, basement use, monthly carrying costs, and missing listing details. HomeScope helps organize these checks into a clear report."
            />
            <FAQItem 
              value="check-renting"
              question="What should I check before making an offer?"
              answer="Ask about roof age, HVAC, electrical, plumbing, permits, open violations, basement legality, insurance costs, taxes, and recent comparable sales. A Full Report gives you a focused question list for the agent."
            />
            <FAQItem 
              value="competition"
              question="Can HomeScope tell me if a property is overpriced?"
              answer="HomeScope can flag price concerns and explain when comparable sales are needed, but it is not an appraisal. Use the report as a pre-check before speaking with your agent, lender, inspector, or appraiser."
            />
            <FAQItem 
              value="misleading"
              question="Can AI detect misleading listing photos?"
              answer="HomeScope can point out photo-based condition signals and missing views, such as limited bathroom photos, no roof photos, unclear basement condition, older finishes, or missing mechanical-system photos. It cannot replace an in-person inspection."
            />
          </Accordion.Root>
        </div>
        </div>

        {/* 购买确认弹窗 */}
        <PurchaseModal
          isOpen={!!selectedProduct}
          onClose={handlePurchaseModalClose}
          product={selectedProduct}
        />
      </SiteLayout>
    </div>
  );
}
