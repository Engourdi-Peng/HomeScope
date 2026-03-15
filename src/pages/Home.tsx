import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { InputCard } from '../components/InputCard';
import type { AnalysisStage, Photo, OptionalDetails } from '../types';
import { submitAnalysis, runAnalysis, compressImageForUpload, uploadImagesToStorage, getAnalysisProgress } from '../lib/api';
import { Sparkles, Camera, FileText, LayoutGrid, AlertTriangle, TrendingUp, CheckCircle } from 'lucide-react';
import { UserMenu } from '../components/UserMenu';
import { LoginModal } from '../components/LoginModal';
import { FAQItem } from '../components/FAQItem';
import { useAuth } from '../contexts/AuthContext';
import * as Accordion from '@radix-ui/react-accordion';

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

  const handleSubmit = async () => {
    // ========== 权限检查 ==========
    // 调试日志
    console.log('=== Analyze Permission Check ===');
    console.log('isAuthenticated:', isAuthenticated);
    console.log('user email:', user?.email);
    console.log('creditsRemaining:', creditsRemaining);

    // 1. 未登录用户不能 Analyze
    if (!isAuthenticated) {
      console.log('analyze blocked reason: NOT_AUTHENTICATED');
      setError('Please sign in first to analyze listings.');
      setIsLoginModalOpen(true);
      return;
    }

    // 2. 已登录但 credits_remaining <= 0 - 提前拦截，避免浪费用户时间
    if (creditsRemaining <= 0) {
      console.log('analyze blocked reason: NO_CREDITS');
      setError('You\'ve used all credits. Purchase more to continue.');
      return;
    }

    // 3. 权限检查通过，继续执行
    console.log('analyze allowed: proceeding with analysis');

    if (photos.length === 0 && description.trim() === '') {
      return;
    }

    setIsLoading(true);
    setError('');
    setAnalyzingCount(Math.min(photos.length, 10));
    setIsComplete(false);
    setActiveStage(null);
    setProgressPct(0);

    try {
      const photosToAnalyze = photos.slice(0, 10);

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

      console.log('Uploaded image URLs:', imageUrls);

      // ========== Step 3: Build request with imageUrls ==========
      const requestData = {
        imageUrls,
        description,
        optionalDetails: Object.keys(optionalDetails).length > 0 ? optionalDetails : undefined,
      };

      console.log('Submitting analysis...');

      // ========== Step 4: Submit to create analysis ID ==========
      setProgressPct(60);
      setProgressLabel('Starting analysis...');

      const submitResult = await submitAnalysis(requestData);
      const analysisId = submitResult.id;

      console.log('Analysis submitted, ID:', analysisId);

      // ========== Step 5: Trigger the analysis runner ==========
      setProgressLabel('Analyzing property...');
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
            sessionStorage.setItem('analysisResult', JSON.stringify(progress.result));
            setIsComplete(true);
            setProgressPct(100);
            setProgressLabel('Analysis complete');
            clearPollTimer();
            // Refresh user profile to update credits display
            refreshProfile();
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

      <div className="relative z-10 w-full max-w-[1200px]">
        
        {/* 顶部导航栏 */}
        <div className="flex justify-between items-center mb-8">
          {/* Logo */}
          <a href="/" className="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="180" height="30" viewBox="0 0 254.145 41.04">
              <g id="组_1" data-name="组 1" transform="translate(-81.15 -88.79)">
                <path id="路径_2" data-name="路径 2" d="M128.43,1.62q-5.76,0-8.685-2.925A10.642,10.642,0,0,1,116.82-9.18h6.39a4.362,4.362,0,0,0,1.215,3.262,5.361,5.361,0,0,0,3.87,1.193,9.1,9.1,0,0,0,4.23-.832A3.1,3.1,0,0,0,134.01-8.73a2.489,2.489,0,0,0-1.417-2.07,33.064,33.064,0,0,0-4.342-1.98,41.918,41.918,0,0,1-5.333-2.317,11.549,11.549,0,0,1-3.668-3.1,7.615,7.615,0,0,1-1.53-4.838,9.444,9.444,0,0,1,3.06-7.47,12,12,0,0,1,8.235-2.7,12.951,12.951,0,0,1,6.03,1.328,9.553,9.553,0,0,1,3.915,3.578,9.36,9.36,0,0,1,1.35,4.9h-6.57a2.9,2.9,0,0,0-1.283-2.52,5.888,5.888,0,0,0-3.442-.9,6.653,6.653,0,0,0-3.488.878A3.058,3.058,0,0,0,124.2-22.86a2.568,2.568,0,0,0,1.462,1.98,36.236,36.236,0,0,0,4.342,2.025,59.009,59.009,0,0,1,5.378,2.475,11.824,11.824,0,0,1,3.645,3.06A7.311,7.311,0,0,1,140.58-8.6,10.017,10.017,0,0,1,137.7-1.35Q134.82,1.62,128.43,1.62Zm27.315,0q-5.13,0-7.9-3.285t-2.768-9.5q0-6.3,2.857-9.742a9.808,9.808,0,0,1,7.988-3.443q4.95,0,7.447,2.272t2.768,6.908h-6.255a3.5,3.5,0,0,0-1.058-2.34,4.231,4.231,0,0,0-2.812-.765q-4.5,0-4.5,6.435,0,3.915,1.035,5.648t3.87,1.732a3,3,0,0,0,2.565-.922,5.571,5.571,0,0,0,.9-2.543h6.255q-.405,4.725-2.812,7.133T155.745,1.62Zm25.83.315a10.253,10.253,0,0,1-5.8-1.643,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93,16.409,16.409,0,0,1,1.372-6.907,10.967,10.967,0,0,1,3.848-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71,10.652,10.652,0,0,1,3.757,4.725,17.2,17.2,0,0,1,1.283,6.795q0,6.21-2.835,9.72A9.761,9.761,0,0,1,181.575,1.935Zm0-6.3a3.8,3.8,0,0,0,3.42-1.845,9.451,9.451,0,0,0,1.17-5.085,9.4,9.4,0,0,0-1.192-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.238,5.018A3.851,3.851,0,0,0,181.575-4.365Zm27.4-20.07A9.925,9.925,0,0,1,214.29-23a9.913,9.913,0,0,1,3.69,4.163,14.5,14.5,0,0,1,1.35,6.5,14.726,14.726,0,0,1-1.373,6.57,10.237,10.237,0,0,1-3.735,4.275A9.652,9.652,0,0,1,208.98,0a8.452,8.452,0,0,1-4.59-1.215V7.83h-6.525V-24.39h6.525V-23A7.473,7.473,0,0,1,208.98-24.435Zm-.18,18.5a3.71,3.71,0,0,0,3.195-1.778,8.015,8.015,0,0,0,1.215-4.613,8.209,8.209,0,0,0-1.08-4.477A3.676,3.676,0,0,0,208.8-18.5a3.5,3.5,0,0,0-3.173,1.688,8.347,8.347,0,0,0-1.058,4.477A8.91,8.91,0,0,0,205.628-7.7,3.465,3.465,0,0,0,208.8-5.94Zm21.51-3.24a6.475,6.475,0,0,0,1.485,3.78,3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q223.83-5.04,223.83-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.783-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.305-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(90 122)" fill="#1c1917"/>
                <path id="路径_3" data-name="路径 3" d="M18.63-19.8V-32.76h6.525V1.62H18.63V-13.725H9.675V1.62H3.15V-32.76H9.675V-19.8ZM41.49,1.935A10.254,10.254,0,0,1,35.685.293a10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93A16.409,16.409,0,0,1,31.928-18.2a10.967,10.967,0,0,1,3.847-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,51.1-18.09,17.2,17.2,0,0,1,52.38-11.3q0,6.21-2.835,9.72A9.761,9.761,0,0,1,41.49,1.935Zm0-6.3A3.8,3.8,0,0,0,44.91-6.21,9.451,9.451,0,0,0,46.08-11.3a9.4,9.4,0,0,0-1.193-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.237,5.018A3.851,3.851,0,0,0,41.49-4.365ZM106.335-9.18A6.475,6.475,0,0,0,107.82-5.4a3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q99.855-5.04,99.855-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.782-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.305-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(78 122)" fill="#707070"/>
                <path id="路径_1" data-name="路径 1" d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z" transform="translate(-763.436 194.985)" fill="#e17100"/>
              </g>
            </svg>
          </a>
          
          {/* 右侧用户菜单 */}
          <UserMenu onLoginClick={() => setIsLoginModalOpen(true)} />
        </div>
        {/* 1. Hero */}
        <div className="text-center mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
          <h1 className="text-4xl md:text-5xl font-light tracking-tight text-stone-900 leading-[1.15] mb-4">
            Know If a Rental Is Worth Inspecting — Before You Go
          </h1>
          <p className="text-lg md:text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed font-light mb-2">
            Upload listing screenshots or paste the description.<br className="hidden sm:inline" />
            AI analyzes the property and tells you if it's worth inspecting.
          </p>
          <p className="text-sm text-stone-500 max-w-lg mx-auto">
            Avoid wasting time on bad rental inspections.
          </p>
        </div>

        {/* 2. Upload Tool - First Screen */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '100ms' }}>
          <div className="bg-white rounded-[2rem] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] border border-stone-200 p-8 md:p-12">
            <h2 className="text-xl font-semibold text-stone-900 mb-2 text-center">Paste the Listing or Upload Screenshots</h2>
            <p className="text-sm text-stone-500 text-center mb-8">
              Add listing screenshots, description text, or both.<br className="hidden sm:inline" />
              The AI will combine them into a full rental analysis.
            </p>
            
            <InputCard
              photos={photos}
              onPhotosChange={setPhotos}
              description={description}
              onDescriptionChange={setDescription}
              optionalDetails={optionalDetails}
              onOptionalDetailsChange={setOptionalDetails}
              onSubmit={handleSubmit}
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
        {/* 3. How It Works */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '200ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-8">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <Camera size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">1. Upload Listing Screenshots</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                Upload screenshots from realestate.com.au, Domain, or any rental website.
              </p>
            </div>
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <Sparkles size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">2. AI Analyzes the Property</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                The AI evaluates kitchens, bathrooms, bedrooms, and overall condition.
              </p>
            </div>
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <FileText size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">3. Get a Decision Report</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                See quality scores, hidden risks, and whether the property is worth inspecting.
              </p>
            </div>
          </div>
        </div>

        {/* 4. What You Get */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '300ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-8">What You Get</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-4 p-5 bg-white rounded-2xl border border-stone-200">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                <LayoutGrid size={24} className="text-green-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Space Condition Scores</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Kitchen, bathroom and bedroom condition evaluated with clear scores.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white rounded-2xl border border-stone-200">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle size={24} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Detect Hidden Listing Risks</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Spot missing information, weak evidence, or exaggerated claims.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white rounded-2xl border border-stone-200">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <TrendingUp size={24} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Competition Estimate</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Understand how competitive the listing may be in the current market.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white rounded-2xl border border-stone-200">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <CheckCircle size={24} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Should You Inspect?</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Get a clear recommendation on whether the property is worth your time.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 5. FAQ */}
        <div className="mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '400ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-[#a8a29e] mb-8">FAQ</h2>
          <Accordion.Root type="single" collapsible className="bg-[rgba(250,250,249,0.4)] border-[0.667px] border-solid border-[rgba(231,229,228,0.8)] rounded-[24px] px-6 max-w-5xl mx-auto">
            <FAQItem 
              value="analyze-listings"
              question="Can AI analyze rental listings?"
              answer="Yes, our AI analyzes rental listing photos to assess space quality, detect potential issues, and provide competition estimates. Upload screenshots from realestate.com.au, Domain, or other rental platforms to get an instant analysis."
            />
            <FAQItem 
              value="evaluate-property"
              question="How to evaluate a rental property before inspection?"
              answer="Before attending a rental inspection, analyze the listing photos carefully. Look for signs of maintenance quality, check if all rooms are shown, and note any inconsistencies between the description and photos. Our tool automates this process using AI."
            />
            <FAQItem 
              value="check-renting"
              question="What should I check when renting a house?"
              answer="When renting, check the condition of kitchen appliances, bathroom fixtures, flooring, walls, and storage space. Also verify natural light, ventilation, and any visible damage. Our rental inspection checklist helps you systematically evaluate each aspect."
            />
            <FAQItem 
              value="competition"
              question="How does AI estimate rental competition?"
              answer="Our AI estimates competition levels based on property presentation quality, attractive features, and market positioning. Well-maintained properties with appealing features typically have higher competition, helping you gauge your chances."
            />
            <FAQItem 
              value="misleading"
              question="Can AI detect misleading listing photos?"
              answer="The AI analyzes staging signs, image quality, and inconsistencies to highlight possible risks in rental listings."
            />
          </Accordion.Root>
        </div>

        {/* Footer */}
        <div className="text-center pt-8 pb-4 border-t border-stone-200">
          <div className="flex justify-center gap-4 mb-3">
            <Link to="/privacy" className="text-xs text-stone-400 hover:text-stone-600 transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="text-xs text-stone-400 hover:text-stone-600 transition-colors">Terms of Service</Link>
          </div>
          <p className="text-xs text-stone-400 font-medium">
            AI Rental Decision Assistant
          </p>
        </div>
        </div>

        {/* 登录弹窗 */}
        <LoginModal 
          isOpen={isLoginModalOpen} 
          onClose={() => setIsLoginModalOpen(false)} 
        />
      </div>
    </div>
  );
}
