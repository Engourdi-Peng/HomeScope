import { useState } from 'react';
import type { BasicAnalysisResult } from '../types';
import { ArrowLeft, Share2, Check, AlertTriangle, CheckCircle, ArrowRight, Zap, Star } from 'lucide-react';

interface BasicResultCardProps {
  result: BasicAnalysisResult;
  onBack: () => void;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  onUpgrade?: () => void;
  /** 在插件模式下由 ExtensionResultView 提供导航，ResultCard 内部导航栏应隐藏 */
  hideNav?: boolean;
  /** 是否为 extension 模式，用于调整样式 */
  isExtension?: boolean;
  analysisId?: string;
}

const recommendationConfig = {
  high: {
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    borderColor: 'border-green-500/40',
    label: 'Recommended Viewing',
    icon: CheckCircle,
    score: 3,
  },
  medium: {
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20',
    borderColor: 'border-amber-500/40',
    label: 'Proceed With Caution',
    icon: AlertTriangle,
    score: 2,
  },
  low: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/40',
    label: 'High Risk Alert',
    icon: AlertTriangle,
    score: 1,
  },
};

const priceFairnessConfig = {
  high: {
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    borderColor: 'border-green-500/30',
    label: 'Good Deal',
  },
  medium: {
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20',
    borderColor: 'border-amber-500/30',
    label: 'Fair Price',
  },
  low: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/30',
    label: 'Overpriced',
  },
};

function BulletList({ items, className = '', darkCard }: { items: string[]; className?: string; darkCard?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-3">
          <span className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${darkCard ? 'bg-white' : 'bg-stone-400'}`}></span>
          <span className={`text-sm leading-relaxed ${darkCard ? 'text-white' : 'text-stone-300'}`}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function BasicResultCard({
  result,
  onBack,
  onShare,
  onUpgrade,
  hideNav,
  isExtension,
  analysisId,
}: BasicResultCardProps) {
  const [copied, setCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const recConfig = recommendationConfig[result.decision.recommendation];
  const RecIcon = recConfig.icon;
  const priceConfig = priceFairnessConfig[result.textAnalysis.priceFairness];

  const handleShare = async () => {
    if (!onShare || !analysisId) return;
    setIsSharing(true);
    try {
      const shareResponse = await onShare(analysisId);
      const fullUrl = shareResponse.shareUrl || `${window.location.origin}/share/${shareResponse.slug}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Share failed:', err);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="w-full container-type-inline-size animate-in fade-in slide-in-from-bottom-12 duration-700 ease-out pb-24 relative z-10">
      {/* Navigation Bar */}
      {/* 在 extension 模式下由 ExtensionResultView 提供导航，此处隐藏 */}
      {!hideNav && (
        <div className="flex items-center justify-between mb-12 relative z-20">
          <button
            onClick={onBack}
            className="group flex items-center gap-3 text-stone-500 hover:text-stone-900 transition-colors"
          >
            <div className="w-8 h-8 rounded-full border border-stone-200 flex items-center justify-center bg-white/50 backdrop-blur-md group-hover:bg-white transition-colors">
              <ArrowLeft size={14} strokeWidth={1.5} />
            </div>
            <span className="text-xs font-medium uppercase tracking-widest">Back</span>
          </button>

          {onShare && analysisId && (
            <button
              onClick={handleShare}
              disabled={isSharing}
              className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-green-400" />
                  <span className="text-xs font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <Share2 size={14} />
                  <span className="text-xs font-medium">Share</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Listing Header - 房源简要信息 */}
      <div className="mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
        <div className="w-full px-6 py-5 rounded-2xl border bg-stone-100/80 border-stone-200/80">
          <div className="flex items-center gap-3 mb-3">
            {result.listingOverview.propertyType && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 bg-stone-200/50 px-2 py-1 rounded">
                {result.listingOverview.propertyType}
              </span>
            )}
          </div>
          <h1 className="text-xl font-semibold text-stone-900 mb-1">
            {result.listingOverview.address || 'Property'}
          </h1>
          <p className="text-lg font-medium text-stone-700">
            {result.listingOverview.price}
          </p>
          <div className="flex gap-3 mt-2 text-sm text-stone-500">
            {result.listingOverview.bedrooms > 0 && (
              <span>{result.listingOverview.bedrooms} bed</span>
            )}
            {result.listingOverview.bathrooms > 0 && (
              <span>{result.listingOverview.bathrooms} bath</span>
            )}
          </div>
        </div>
      </div>

      {/* Report Summary */}
      <div className="mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '100ms' }}>
        <div className="w-full px-6 py-5 rounded-2xl border bg-stone-100/80 border-stone-200/80">
          <div className="text-base font-semibold text-stone-800 mb-2">Report Summary</div>
          <div className="text-stone-600 text-sm leading-relaxed">
            {result.decision.summary}
          </div>
        </div>
      </div>

      {/* Overall Score - Hero Card */}
      <div className="bg-[#282828] rounded-3xl p-6 @container[size>=600px]:p-10 @container[size>=700px]:p-14 shadow-[0_8px_40px_rgba(0,0,0,0.20)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '150ms' }}>
        <div className="flex flex-col gap-8 @container[size>=560px]:flex-row @container[size>=560px]:items-start @container[size>=560px]:gap-10">

          {/* Score Section */}
          <div className="flex flex-col items-center @container[size>=560px]:items-start @container[size>=560px]:w-52 shrink-0">
            <div className="text-[10px] font-medium uppercase tracking-widest text-[#B3B3B3] mb-3">
              Overall Score
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl @container:text-7xl @container[size>=700px]:text-9xl font-light tracking-tight text-white">
                {/* Basic analysis score based on recommendation */}
                {recConfig.score === 3 ? 85 : recConfig.score === 2 ? 55 : 25}
              </span>
              <span className="text-xl @container:text-2xl @container[size>=700px]:text-4xl font-light text-[#B3B3B3]">/100</span>
            </div>
            {/* Decision Priority Tag */}
            <div className={`mt-4 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
              result.decision.recommendation === 'high' ? 'bg-green-500/20 text-green-400 border border-green-500/40' :
              result.decision.recommendation === 'medium' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
              'bg-red-500/20 text-red-400 border border-red-500/40'
            }`}>
              {result.decision.recommendation.toUpperCase()} PRIORITY
            </div>
          </div>

          {/* Divider */}
          <div className="hidden @container[size>=560px]:block w-px @container[size>=560px]:h-36 bg-stone-600/70 self-stretch shrink-0"></div>

          {/* Verdict & Pros/Cons */}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Verdict</div>
            <p className="text-lg @container:text-xl @container[size>=700px]:text-2xl font-medium text-white leading-snug mb-5">
              {result.decision.summary}
            </p>

            {/* AI Confidence */}
            <div className="flex flex-col gap-3 @container[size>=480px]:flex-row @container[size>=480px]:gap-4 @container[size>=480px]:flex-wrap mb-5">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] font-medium uppercase tracking-widest text-[#BDBDBD] shrink-0">
                  AI Confidence
                </div>
                <div className="h-4 w-px bg-white/10"></div>
                <div className="text-xs font-semibold text-amber-400">
                  Medium
                </div>
              </div>

              {/* Understood */}
              <div className="inline-flex items-start gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] font-medium uppercase tracking-widest text-[#BDBDBD] shrink-0">
                  Analysis Type
                </div>
                <div className="h-4 w-px bg-white/10"></div>
                <div className="text-xs text-[#D6D6D6]">
                  Basic (Text Only)
                </div>
              </div>
            </div>

            <div className="h-px bg-white/10 my-5 @container[size>=560px]:my-6"></div>

            <div className="grid grid-cols-1 @container:text-sm @container[size>=480px]:grid-cols-2 @container[size>=700px]:grid-cols-2 gap-8">
              {/* Pros */}
              <div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Pros</div>
                <BulletList items={result.textAnalysis.pros.slice(0, 4)} darkCard />
              </div>
              {/* Cons */}
              <div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Cons</div>
                <BulletList items={result.textAnalysis.cons.slice(0, 4)} darkCard />
              </div>
            </div>

            {/* Risk Keywords */}
            {result.textAnalysis.riskKeywords && result.textAnalysis.riskKeywords.length > 0 && (
              <div className="mt-7">
                <div className="h-px bg-white/10 mb-6"></div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-amber-400 mb-3">Risk Signals</div>
                <div className="flex flex-wrap gap-2">
                  {result.textAnalysis.riskKeywords.slice(0, 6).map((keyword, i) => (
                    <span
                      key={i}
                      className="text-xs bg-amber-500/20 text-amber-300 px-3 py-1.5 rounded-full border border-amber-500/30"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section Divider */}
      <div className="h-px bg-stone-200 my-14"></div>

      {/* Price Assessment */}
      <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
            <span className="text-lg">$</span>
          </div>
          <h3 className="text-base font-semibold text-stone-900">Price Assessment</h3>
        </div>

        <div className="flex flex-col @container[size>=480px]:flex-row @container[size>=480px]:items-center gap-4 @container[size>=480px]:gap-6">
          <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${priceConfig.bgColor} ${priceConfig.color} border ${priceConfig.borderColor}`}>
            {priceConfig.label}
          </span>
          {result.textAnalysis.priceReasoning && (
            <p className="text-sm text-stone-600 leading-relaxed flex-1">
              {result.textAnalysis.priceReasoning}
            </p>
          )}
        </div>
      </div>

      {/* Recommended Actions */}
      {result.decision.actions && result.decision.actions.length > 0 && (
        <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '250ms' }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
              <ArrowRight size={18} className="text-stone-600" strokeWidth={1.5} />
            </div>
            <h3 className="text-base font-semibold text-stone-900">Recommended Actions</h3>
          </div>

          <ul className="space-y-3">
            {result.decision.actions.map((action, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-stone-400 mt-2 shrink-0"></span>
                <span className="text-sm text-stone-600 leading-relaxed">{action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Upgrade Prompt */}
      {result.upgradePrompt && onUpgrade && (
        <div className="bg-gradient-to-br from-stone-800 to-stone-900 rounded-3xl p-6 @container[size>=600px]:p-10 shadow-[0_8px_40px_rgba(0,0,0,0.15)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '300ms' }}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0">
              <Zap size={24} className="text-yellow-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-2">{result.upgradePrompt.title}</h3>
              <ul className="space-y-2 mb-6">
                {result.upgradePrompt.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-stone-300">
                    <Check size={14} className="text-green-400 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                onClick={onUpgrade}
                className="w-full bg-white text-stone-900 font-semibold py-3 px-6 rounded-xl hover:bg-stone-100 transition-colors"
              >
                Try Deep Analysis (uses 1 credit)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Note */}
      <p className="text-xs text-stone-500 text-center mt-10">
        Basic analysis based on listing description. Upload photos for visual inspection.
      </p>
    </div>
  );
}
