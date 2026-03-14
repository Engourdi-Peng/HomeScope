import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { InputCard } from '../components/InputCard';
import type { AnalysisStage, Photo, OptionalDetails } from '../types';
import { submitAnalysis, runAnalysis, compressImageForUpload, uploadImagesToStorage, getAnalysisProgress } from '../lib/api';
import { Sparkles, Camera, FileText, LayoutGrid, AlertTriangle, TrendingUp, CheckCircle, ChevronDown } from 'lucide-react';
import { UserMenu } from '../components/UserMenu';
import { LoginModal } from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';

interface FAQItemProps {
  question: string;
  answer: string;
}

function FAQItem({ question, answer }: FAQItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left bg-white hover:bg-stone-50 transition-colors"
      >
        <span className="text-sm font-medium text-stone-800">{question}</span>
        {isOpen ? <ChevronDown size={18} className="text-stone-400 transform rotate-180 transition-transform" /> : <ChevronDown size={18} className="text-stone-400" />}
      </button>
      {isOpen && (
        <div className="p-4 pt-0 text-sm text-stone-600 leading-relaxed bg-white">
          {answer}
        </div>
      )}
    </div>
  );
}

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
      setError('You\'ve used all free analyses. Purchase more credits to continue.');
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
        
        {/* 顶部用户菜单 */}
        <div className="flex justify-between items-center mb-8">
          {/* 剩余次数显示 */}
          {isAuthenticated && (
            <div className="text-sm font-medium text-stone-600 bg-white/70 backdrop-blur-md px-4 py-2 rounded-full border border-stone-200">
              Free analyses left: {creditsRemaining}
            </div>
          )}
          <div className="flex items-center gap-4">
            {isAuthenticated && (
              <div className="text-[10px] text-stone-400 hidden md:block">
                DEBUG: creditsRemaining={creditsRemaining}, isAuthenticated={String(isAuthenticated)}, user={user?.email}
              </div>
            )}
          </div>
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
                    {error.includes('free analyses') && (
                      <button
                        onClick={() => {
                          // TODO: Navigate to purchase/upgrade page
                          alert('Purchase credits coming soon! Contact support@listinganalyzer.com for now.');
                        }}
                        className="mt-3 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                      >
                        Buy More Credits
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
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-8">FAQ</h2>
          <div className="space-y-3 w-full">
            <FAQItem 
              question="Can AI analyze rental listings?"
              answer="Yes, our AI analyzes rental listing photos to assess space quality, detect potential issues, and provide competition estimates. Upload screenshots from realestate.com.au, Domain, or other rental platforms to get an instant analysis."
            />
            <FAQItem 
              question="How to evaluate a rental property before inspection?"
              answer="Before attending a rental inspection, analyze the listing photos carefully. Look for signs of maintenance quality, check if all rooms are shown, and note any inconsistencies between the description and photos. Our tool automates this process using AI."
            />
            <FAQItem 
              question="What should I check when renting a house?"
              answer="When renting, check the condition of kitchen appliances, bathroom fixtures, flooring, walls, and storage space. Also verify natural light, ventilation, and any visible damage. Our rental inspection checklist helps you systematically evaluate each aspect."
            />
            <FAQItem 
              question="How does AI estimate rental competition?"
              answer="Our AI estimates competition levels based on property presentation quality, attractive features, and market positioning. Well-maintained properties with appealing features typically have higher competition, helping you gauge your chances."
            />
            <FAQItem 
              question="Can AI detect misleading listing photos?"
              answer="The AI analyzes staging signs, image quality, and inconsistencies to highlight possible risks in rental listings."
            />
          </div>
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
