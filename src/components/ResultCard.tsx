import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../types';
import { ListingHeader } from './ListingHeader';
import { Check, AlertCircle, ArrowRight, ArrowLeft, TrendingUp, AlertTriangle, MessageCircle, Eye, DollarSign, Share2, Copy, CheckCircle, Sun, MessageSquare, Send, SquareCheck, Zap } from 'lucide-react';

function AnimatedNumber({ target, duration = 1500 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(easeOut * target));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [target, duration]);

  return <>{count}</>;
}

interface ResultProps {
  result: AnalysisResult;
  onBack: () => void;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  /** 在插件模式下由 ExtensionResultView 提供导航，ResultCard 内部导航栏应隐藏 */
  hideNav?: boolean;
  /** 是否为公开分享页，用于显示不同的分享文案 */
  isPublicShare?: boolean;
  /** 升级到深度分析的回调 */
  onUpgrade?: () => void;
  /** 是否为 extension 模式 */
  isExtension?: boolean;
  analysisId?: string;
  /** 是否为基础分析模式（用于区分卡片显示） */
  isBasicAnalysis?: boolean;
}

const verdictConfig = {
  'Strong Apply': {
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    label: 'Strong Apply',
  },
  'Apply With Caution': {
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    label: 'Apply With Caution',
  },
  'Not Recommended': {
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    label: 'Not Recommended',
  },
  'Worth Inspecting': {
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    label: 'Recommended Viewing',
  },
  'Proceed With Caution': {
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    label: 'Proceed With Caution',
  },
  'Likely Overpriced / Risky': {
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    label: 'High Risk Alert',
  },
  'Need More Evidence': {
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    label: 'Need More Evidence',
  },
};

const competitionConfig = {
  LOW: {
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    label: 'LOW',
  },
  MEDIUM: {
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    label: 'MEDIUM',
  },
  HIGH: {
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    label: 'HIGH',
  },
};

const rentFairnessConfig = {
  underpriced: {
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    label: 'Underpriced',
  },
  fair: {
    color: 'text-stone-600',
    bgColor: 'bg-stone-50',
    borderColor: 'border-stone-200',
    label: 'Fair',
  },
  slightly_overpriced: {
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    label: 'Slightly Overpriced',
  },
  overpriced: {
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    label: 'Overpriced',
  },
};

// Price Assessment config for sale mode (same verdicts as rentFairnessConfig)
const priceAssessmentConfig = rentFairnessConfig;

function getSpaceTypeLabel(spaceType: string): string {
  const labels: Record<string, string> = {
    kitchen: 'Kitchen',
    bathroom: 'Bathroom',
    bedroom: 'Bedroom',
    living_room: 'Living Room',
    garage: 'Garage',
    laundry: 'Laundry',
    exterior: 'Exterior',
    hallway: 'Hallway',
    storage: 'Storage',
    dining: 'Dining',
    unknown: 'Unclassified',
  };
  return labels[spaceType] || spaceType;
}

function formatDetectedRooms(rooms: string[]): string {
  const normalized = rooms
    .map((r) => getSpaceTypeLabel(r).toLowerCase())
    .filter(Boolean);

  if (normalized.length === 0) return '';
  if (normalized.length === 1) return normalized[0];
  if (normalized.length === 2) return `${normalized[0]} and ${normalized[1]}`;
  return `${normalized.slice(0, -1).join(', ')} and ${normalized[normalized.length - 1]}`;
}

function getScoreColor(score: number): string {
  if (score >= 75) return 'text-green-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-600';
}

function BulletList({ items, className = '', darkCard }: { items: string[]; className?: string; darkCard?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-3">
          <span className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${darkCard ? 'bg-white' : 'bg-stone-400'}`}></span>
          <span className={`text-sm leading-relaxed ${darkCard ? 'text-white' : 'text-stone-600'}`}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SimpleBulletList({ items, className = '' }: { items: string[]; className?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="text-stone-400 text-sm">•</span>
          <span className="text-sm leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionDivider() {
  return <div className="h-px bg-stone-200 my-14"></div>;
}

export function ResultCard({ result, onBack, onShare, hideNav, isPublicShare, onUpgrade, isExtension, analysisId, isBasicAnalysis }: ResultProps) {
  // Guard: if result is undefined/null, render nothing
  if (!result) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="ext-spinner" />
      </div>
    );
  }

  const [isSharing, setIsSharing] = useState(false);
  const [shareResult, setShareResult] = useState<{ slug: string; shareUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Check if this is a basic analysis (new format)
  const isBasic = isBasicAnalysis || result.analysisType === 'basic';

  const config = verdictConfig[result.verdict] || verdictConfig['Need More Evidence'];
  const competitionRisk = result.competitionRisk;
  const recommendation = result.recommendation;
  const spaceAnalysis = result.spaceAnalysis;
  const analyzedPhotoCount =
    result.analyzedPhotoCount ??
    (result as unknown as { analyzed_photo_count?: number }).analyzed_photo_count;
  const detectedRooms =
    result.detectedRooms ??
    (result as unknown as { detected_rooms?: string[] }).detected_rooms ??
    [];
  const detectedRoomsText = detectedRooms.length > 0 ? formatDetectedRooms(detectedRooms) : '';
  const detectedRoomsCount = detectedRooms.length;

  // Provide default values for basic analysis mode
  const decisionPriority = result.decisionPriority ?? (isBasic ? 'MEDIUM' : undefined);
  const confidenceLevel = result.confidenceLevel ?? (isBasic ? 'Medium' : undefined);
  const realityCheck = result.realityCheck ?? (isBasic ? '' : undefined);
  const questionsToAsk = result.questionsToAsk ?? [];
  const risks = result.risks ?? (isBasic ? result.riskSignals : []) ?? [];
  const hiddenRisks = result.hiddenRisks ?? (isBasic ? [] : undefined);
  const whatLooksGood = result.whatLooksGood ?? [];
  const riskSignals = result.riskSignals ?? [];
  const reality_check = result.reality_check;

  // Clipboard helper compatible with extension side panel
  const copyToClipboardFallback = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  const handleShare = async () => {
    if (!onShare) return;
    const analysisId = result.id || '';

    setIsSharing(true);
    try {
      const shareResponse = await onShare(analysisId);
      setShareResult(shareResponse);

      // Use the full shareUrl if provided, otherwise construct from origin
      const fullUrl = shareResponse.shareUrl || `${window.location.origin}/share/${shareResponse.slug}`;
      copyToClipboardFallback(fullUrl);
      setCopied(true);

      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Share failed:', err);
    } finally {
      setIsSharing(false);
    }
  };

  const copyToClipboard = () => {
    if (!shareResult) return;
    const fullUrl = shareResult.shareUrl || `${window.location.origin}/share/${shareResult.slug}`;
    copyToClipboardFallback(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`w-full container-type-inline-size animate-in fade-in slide-in-from-bottom-12 duration-700 ease-out pb-24 relative z-10 ${isExtension ? 'bg-[#FDFCF9]' : ''}`}>

      {/* Header / Navigation */}
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

          <a href="/" className="absolute left-1/2 -translate-x-1/2">
            <svg xmlns="http://www.w3.org/2000/svg" width="140" height="23" viewBox="0 0 254.145 41.04">
              <g id="组_1" data-name="组 1" transform="translate(-81.15 -88.79)">
                <path id="路径_2" data-name="路径 2" d="M128.43,1.62q-5.76,0-8.685-2.925A10.642,10.642,0,0,1,116.82-9.18h6.39a4.362,4.362,0,0,0,1.215,3.262,5.361,5.361,0,0,0,3.87,1.193,9.1,9.1,0,0,0,4.23-.832A3.1,3.1,0,0,0,134.01-8.73a2.489,2.489,0,0,0-1.417-2.07,33.064,33.064,0,0,0-4.342-1.98,41.918,41.918,0,0,1-5.333-2.317,11.549,11.549,0,0,1-3.668-3.1,7.615,7.615,0,0,1-1.53-4.838,9.444,9.444,0,0,1,3.06-7.47,12,12,0,0,1,8.235-2.7,12.951,12.951,0,0,1,6.03,1.328,9.553,9.553,0,0,1,3.915,3.578,9.36,9.36,0,0,1,1.35,4.9h-6.57a2.9,2.9,0,0,0-1.283-2.52,5.888,5.888,0,0,0-3.442-.9,6.653,6.653,0,0,0-3.488.878A3.058,3.058,0,0,0,124.2-22.86a2.568,2.568,0,0,0,1.462,1.98,36.236,36.236,0,0,0,4.342,2.025,59.009,59.009,0,0,1,5.378,2.475,11.824,11.824,0,0,1,3.645,3.06A7.311,7.311,0,0,1,140.58-8.6,10.017,10.017,0,0,1,137.7-1.35Q134.82,1.62,128.43,1.62Zm27.315,0q-5.13,0-7.9-3.285t-2.768-9.5q0-6.3,2.857-9.742a9.808,9.808,0,0,1,7.988-3.443q4.95,0,7.447,2.272t2.768,6.908h-6.255a3.5,3.5,0,0,0-1.058-2.34,4.231,4.231,0,0,0-2.812-.765q-4.5,0-4.5,6.435,0,3.915,1.035,5.648t3.87,1.732a3,3,0,0,0,2.565-.922,5.571,5.571,0,0,0,.9-2.543h6.255q-.405,4.725-2.812,7.133T155.745,1.62Zm25.83.315a10.253,10.253,0,0,1-5.8-1.643,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93,16.409,16.409,0,0,1,1.372-6.907,10.967,10.967,0,0,1,3.848-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71,10.652,10.652,0,0,1,3.757,4.725,17.2,17.2,0,0,1,1.283,6.795q0,6.21-2.835,9.72A9.761,9.761,0,0,1,181.575,1.935Zm0-6.3a3.8,3.8,0,0,0,3.42-1.845,9.451,9.451,0,0,0,1.17-5.085,9.4,9.4,0,0,0-1.192-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.238,5.018A3.851,3.851,0,0,0,181.575-4.365Zm27.4-20.07A9.925,9.925,0,0,1,214.29-23a9.913,9.913,0,0,1,3.69,4.163,14.5,14.5,0,0,1,1.35,6.5,14.726,14.726,0,0,1-1.373,6.57,10.237,10.237,0,0,1-3.735,4.275A9.652,9.652,0,0,1,208.98,0a8.452,8.452,0,0,1-4.59-1.215V7.83h-6.525V-24.39h6.525V-23A7.473,7.473,0,0,1,208.98-24.435Zm-.18,18.5a3.71,3.71,0,0,0,3.195-1.778,8.015,8.015,0,0,0,1.215-4.613,8.209,8.209,0,0,0-1.08-4.477A3.676,3.676,0,0,0,208.8-18.5a3.5,3.5,0,0,0-3.173,1.688,8.347,8.347,0,0,0-1.058,4.477A8.91,8.91,0,0,0,205.628-7.7,3.465,3.465,0,0,0,208.8-5.94Zm21.51-3.24a6.475,6.475,0,0,0,1.485,3.78,3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q223.83-5.04,223.83-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.783-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.305-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(90 122)" fill="#1c1917"/>
                <path id="路径_3" data-name="路径 3" d="M18.63-19.8V-32.76h6.525V1.62H18.63V-13.725H9.675V1.62H3.15V-32.76H9.675V-19.8ZM41.49,1.935A10.254,10.254,0,0,1,35.685.293a10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93A16.409,16.409,0,0,1,31.928-18.2a10.967,10.967,0,0,1,3.847-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,51.1-18.09,17.2,17.2,0,0,1,52.38-11.3q0,6.21-2.835,9.72A9.761,9.761,0,0,1,41.49,1.935Zm0-6.3A3.8,3.8,0,0,0,44.91-6.21,9.451,9.451,0,0,0,46.08-11.3a9.4,9.4,0,0,0-1.193-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.237,5.018A3.851,3.851,0,0,0,41.49-4.365ZM106.335-9.18A6.475,6.475,0,0,0,107.82-5.4a3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q99.855-5.04,99.855-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.782-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.305-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(78 122)" fill="#707070"/>
                <path id="路径_1" data-name="路径 1" d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z" transform="translate(-763.436 194.985)" fill="#e17100"/>
              </g>
            </svg>
          </a>
        </div>
      )}

      <div className="space-y-0">

        {/* Listing Header - 房源简要信息区块 */}
        {result.listingInfo && (
          <ListingHeader listing={result.listingInfo} />
        )}

        {/* Report Summary */}
        {(result.finalRecommendation?.reason || result.quickSummary) && (
          <div className="mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
            <div className="w-full px-6 py-5 rounded-2xl border bg-stone-100/80 border-stone-200/80">
              <div className="text-base font-semibold text-stone-800 mb-2">Report Summary</div>
              <div className="text-stone-600 text-sm leading-relaxed">
                {result.finalRecommendation?.reason || result.quickSummary}
              </div>
            </div>
          </div>
        )}

        {/* Overall Score - Hero Card */}
        {/*
          容器查询（@container）替代视口断点（@lg/@md）：
          - side panel 宽度约 600-720px，@lg/@md 基于视口（768+/1024+）不会触发
          - @container 让 Hero 根据自身可用宽度响应，适配插件和 web 两种环境
        */}
        <div className="bg-[#282828] rounded-3xl p-6 @container[size>=600px]:p-10 @container[size>=700px]:p-14 shadow-[0_8px_40px_rgba(0,0,0,0.20)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
          <div className="flex flex-col gap-8 @container[size>=560px]:flex-row @container[size>=560px]:items-start @container[size>=560px]:gap-10">

            {/* Score Section */}
            <div className="flex flex-col items-center @container[size>=560px]:items-start @container[size>=560px]:w-52 shrink-0">
              <div className="text-[10px] font-medium uppercase tracking-widest text-[#B3B3B3] mb-3">
                Overall Score
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-6xl @container:text-7xl @container[size>=700px]:text-9xl font-light tracking-tight text-white">
                  <AnimatedNumber target={result.overallScore} />
                </span>
                <span className="text-xl @container:text-2xl @container[size>=700px]:text-4xl font-light text-[#B3B3B3]">/100</span>
              </div>
              {/* Decision Priority Tag */}
              <div className={`mt-4 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                decisionPriority === 'HIGH' ? 'bg-green-500/20 text-green-400 border border-green-500/40' :
                decisionPriority === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
                'bg-red-500/20 text-red-400 border border-red-500/40'
              }`}>
                {decisionPriority || 'MEDIUM'} PRIORITY
              </div>

              {/* Would I Buy? - Sale mode only */}
              {result.reportMode === 'sale' && result.would_i_buy && (
                <div className={`mt-4 px-5 py-3 rounded-2xl text-sm font-bold uppercase tracking-wide border-2 ${
                  result.would_i_buy.answer === 'YES'
                    ? 'bg-green-500/20 text-green-300 border-green-500/50'
                    : result.would_i_buy.answer === 'NO'
                    ? 'bg-red-500/20 text-red-300 border-red-500/50'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {result.would_i_buy.answer === 'YES' ? 'YES' : result.would_i_buy.answer === 'NO' ? 'NO' : 'MAYBE'}
                    </span>
                    <span className="text-[10px] font-normal opacity-70 ml-1">
                      {result.would_i_buy.confidence} CONFIDENCE
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Divider — 仅在横向布局时显示 */}
            <div className="hidden @container[size>=560px]:block w-px @container[size>=560px]:h-36 bg-stone-600/70 self-stretch shrink-0"></div>

            {/* Verdict & Pros/Cons */}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Verdict</div>
              <p className="text-lg @container:text-xl @container[size>=700px]:text-2xl font-medium text-white leading-snug mb-5">{result.quickSummary}</p>

              {/* AI Confidence + Market Position + Understood — 窄屏纵向堆叠，宽屏横向单行 */}
              <div className="flex flex-col gap-3 @container[size>=480px]:flex-row @container[size>=480px]:gap-4 @container[size>=480px]:flex-wrap mb-5">
                {/* AI Confidence */}
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 @container:text-xs">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-[#BDBDBD] shrink-0">
                    AI Confidence
                  </div>
                  <div className="h-4 w-px bg-white/10"></div>
                  <div className={`text-xs font-semibold ${
                    confidenceLevel === 'High' ? 'text-green-400' :
                    confidenceLevel === 'Medium' ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {confidenceLevel || 'Medium'}
                  </div>
                </div>

                {/* Market Position */}
                {result.scoreContext && (
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-[#BDBDBD] shrink-0">
                      Market Position
                    </div>
                    <div className="h-4 w-px bg-white/10"></div>
                    <div className={`text-xs font-semibold ${
                      result.scoreContext.marketPosition === 'Above Average' ? 'text-green-400' :
                      result.scoreContext.marketPosition === 'Below Average' ? 'text-red-400' :
                      'text-amber-400'
                    }`}>
                      {result.scoreContext.marketPosition}
                    </div>
                  </div>
                )}

                {/* Understood */}
                {(typeof analyzedPhotoCount === 'number' || detectedRooms.length > 0) && (
                  <div className="inline-flex items-start gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-[#BDBDBD] shrink-0">
                      Understood
                    </div>
                    <div className="h-4 w-px bg-white/10"></div>
                    <div className="space-y-0.5 text-xs text-[#D6D6D6]">
                      {typeof analyzedPhotoCount === 'number' && (
                        <div>
                          Analyzed {analyzedPhotoCount} screenshot{analyzedPhotoCount === 1 ? '' : 's'}
                          {detectedRoomsCount > 0 ? ` across ${detectedRoomsCount} space${detectedRoomsCount === 1 ? '' : 's'}` : ''}
                        </div>
                      )}
                      {detectedRoomsText && <div>Detected {detectedRoomsText}</div>}
                    </div>
                  </div>
                )}
              </div>

              {/* Score Context Explanation — 窄屏时显示在统计区下方 */}
              {result.scoreContext?.explanation && (
                <div className="text-[10px] text-[#888888] mb-4 @container[size>=480px]:hidden">
                  {result.scoreContext.explanation}
                </div>
              )}

              <div className="h-px bg-white/10 my-5 @container[size>=560px]:my-6"></div>

              <div className="grid grid-cols-1 @container:text-sm @container[size>=480px]:grid-cols-2 @container[size>=700px]:grid-cols-2 gap-8">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Pros</div>
                  <BulletList items={whatLooksGood.slice(0, 4)} darkCard />
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Cons</div>
                  <BulletList items={riskSignals.slice(0, 4)} darkCard />
                </div>
              </div>

              {/* Hidden Risk Signals */}
              {hiddenRisks && hiddenRisks.length > 0 && (
                <div className="mt-7">
                  <div className="h-px bg-white/10 mb-6"></div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-red-400 mb-3">Hidden Risk Signals</div>
                  <BulletList items={hiddenRisks.slice(0, 3)} darkCard />
                </div>
              )}
            </div>
          </div>
        </div>

        <SectionDivider />

        {/* Rent Fairness (rent mode) / Price Assessment (sale mode) */}
        {(result.reportMode === 'sale' ? result.price_assessment : result.rent_fairness) && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '150ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
                <DollarSign size={18} className="text-stone-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">
                {result.reportMode === 'sale' ? 'Price Assessment' : 'Rent Fairness'}
              </h3>
            </div>

            {result.reportMode === 'sale' && result.price_assessment ? (
              <>
                <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-2 gap-6 mb-6">
                  <div className="p-4 bg-stone-50 rounded-xl">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Estimated Value Range</div>
                    <div className="text-xl font-semibold text-stone-800">
                      {result.price_assessment.estimated_min ? `$${result.price_assessment.estimated_min.toLocaleString()}` : '—'}
                      {' – '}
                      {result.price_assessment.estimated_max ? `$${result.price_assessment.estimated_max.toLocaleString()}` : '—'}
                    </div>
                  </div>

                  <div className="p-4 bg-stone-50 rounded-xl">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Asking Price</div>
                    <div className="text-xl font-semibold text-stone-800">
                      {result.price_assessment.asking_price ? `$${result.price_assessment.asking_price.toLocaleString()}` : '—'}
                    </div>
                  </div>
                </div>

                <div className="mb-4">
                  <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${priceAssessmentConfig[result.price_assessment.verdict as keyof typeof priceAssessmentConfig]?.bgColor || priceAssessmentConfig.fair.bgColor} ${priceAssessmentConfig[result.price_assessment.verdict as keyof typeof priceAssessmentConfig]?.color || priceAssessmentConfig.fair.color} border ${priceAssessmentConfig[result.price_assessment.verdict as keyof typeof priceAssessmentConfig]?.borderColor || priceAssessmentConfig.fair.borderColor}`}>
                    {priceAssessmentConfig[result.price_assessment.verdict as keyof typeof priceAssessmentConfig]?.label || 'Fair'}
                  </span>
                </div>

                {result.price_assessment.explanation && (
                  <p className="text-sm text-stone-600 leading-relaxed">{result.price_assessment.explanation}</p>
                )}
              </>
            ) : result.rent_fairness ? (
              <>
                <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-2 gap-6 mb-6">
                  <div className="p-4 bg-stone-50 rounded-xl">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Estimated Market Range</div>
                    <div className="text-xl font-semibold text-stone-800">
                      ${result.rent_fairness.estimated_min} – ${result.rent_fairness.estimated_max}
                      <span className="text-sm font-normal text-stone-500 ml-1">/ week</span>
                    </div>
                  </div>

                  <div className="p-4 bg-stone-50 rounded-xl">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Listing Price</div>
                    <div className="text-xl font-semibold text-stone-800">
                      ${result.rent_fairness.listing_price}
                      <span className="text-sm font-normal text-stone-500 ml-1">/ week</span>
                    </div>
                  </div>
                </div>

                <div className="mb-4">
                  <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${rentFairnessConfig[result.rent_fairness.verdict as keyof typeof rentFairnessConfig]?.bgColor || rentFairnessConfig.fair.bgColor} ${rentFairnessConfig[result.rent_fairness.verdict as keyof typeof rentFairnessConfig]?.color || rentFairnessConfig.fair.color} border ${rentFairnessConfig[result.rent_fairness.verdict as keyof typeof rentFairnessConfig]?.borderColor || rentFairnessConfig.fair.borderColor}`}>
                    {rentFairnessConfig[result.rent_fairness.verdict as keyof typeof rentFairnessConfig]?.label || 'Fair'}
                  </span>
                </div>

                {result.rent_fairness.explanation && (
                  <p className="text-sm text-stone-600 leading-relaxed">{result.rent_fairness.explanation}</p>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* Deal Breakers - Sale mode only, appears after Price Assessment */}
        {result.reportMode === 'sale' && result.deal_breakers && result.deal_breakers.items && result.deal_breakers.items.length > 0 && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '175ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                result.deal_breakers.overall_severity === 'CRITICAL' ? 'bg-red-100' :
                result.deal_breakers.overall_severity === 'HIGH' ? 'bg-orange-100' :
                result.deal_breakers.overall_severity === 'MODERATE' ? 'bg-amber-100' :
                'bg-green-100'
              }`}>
                <AlertTriangle size={18} className={
                  result.deal_breakers.overall_severity === 'CRITICAL' ? 'text-red-600' :
                  result.deal_breakers.overall_severity === 'HIGH' ? 'text-orange-600' :
                  result.deal_breakers.overall_severity === 'MODERATE' ? 'text-amber-600' :
                  'text-green-600'
                } strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Deal Breakers</h3>
              {/* Overall Severity Badge */}
              <span className={`ml-auto px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${
                result.deal_breakers.overall_severity === 'CRITICAL' ? 'bg-red-100 text-red-700 border-red-200' :
                result.deal_breakers.overall_severity === 'HIGH' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                result.deal_breakers.overall_severity === 'MODERATE' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                'bg-green-100 text-green-700 border-green-200'
              }`}>
                {result.deal_breakers.overall_severity === 'CRITICAL' ? 'CRITICAL' :
                 result.deal_breakers.overall_severity === 'HIGH' ? 'HIGH RISK' :
                 result.deal_breakers.overall_severity === 'MODERATE' ? 'MODERATE' : 'LOW'}
              </span>
            </div>

            {/* Summary */}
            {result.deal_breakers.summary && (
              <p className="text-sm text-stone-600 mb-6">{result.deal_breakers.summary}</p>
            )}

            {/* Deal Breaker Items */}
            <div className="space-y-4">
              {result.deal_breakers.items.map((item, index) => (
                <div key={index} className={`p-4 rounded-xl border ${
                  item.severity === 'CRITICAL' ? 'bg-red-50 border-red-200' :
                  item.severity === 'HIGH' ? 'bg-orange-50 border-orange-200' :
                  item.severity === 'MODERATE' ? 'bg-amber-50 border-amber-200' :
                  'bg-stone-50 border-stone-200'
                }`}>
                  <div className="flex items-start gap-3">
                    {/* Severity Icon */}
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
                      item.severity === 'CRITICAL' ? 'bg-red-500 text-white' :
                      item.severity === 'HIGH' ? 'bg-orange-500 text-white' :
                      item.severity === 'MODERATE' ? 'bg-amber-500 text-white' :
                      'bg-stone-400 text-white'
                    }`}>
                      {item.severity === 'CRITICAL' ? '!' : item.severity === 'HIGH' ? '!' : item.severity === 'MODERATE' ? '~' : 'i'}
                    </span>

                    <div className="flex-1 min-w-0">
                      {/* Title and Category */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-stone-800">{item.title}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                          item.category === 'LEGAL' ? 'bg-purple-100 text-purple-700' :
                          item.category === 'STRUCTURAL' ? 'bg-blue-100 text-blue-700' :
                          item.category === 'LOCATION' ? 'bg-teal-100 text-teal-700' :
                          item.category === 'FINANCIAL' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-stone-100 text-stone-600'
                        }`}>
                          {item.category}
                        </span>
                      </div>

                      {/* Description */}
                      <p className="text-sm text-stone-600 mb-2">{item.description}</p>

                      {/* Why it Matters */}
                      {item.why_it_matters && (
                        <div className="mb-2">
                          <span className="text-[10px] font-medium uppercase tracking-widest text-stone-400">Why it matters: </span>
                          <span className="text-xs text-stone-500">{item.why_it_matters}</span>
                        </div>
                      )}

                      {/* Mitigation */}
                      {item.mitigation && (
                        <div className="flex items-start gap-1.5">
                          <span className="text-[10px] font-medium text-green-600 shrink-0">Fix:</span>
                          <span className="text-xs text-stone-500">{item.mitigation}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agent Lingo Translator */}
        {result.agentLingoTranslation && result.agentLingoTranslation.shouldDisplay === true && result.agentLingoTranslation.phrases && result.agentLingoTranslation.phrases.length > 0 && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '200ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <MessageSquare size={18} className="text-amber-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Reality Check</h3>
            </div>

            <div className="space-y-4">
              {result.agentLingoTranslation.phrases.map((item, index) => (
                <div key={index} className="p-4 bg-stone-50 rounded-xl">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="text-xs font-medium text-stone-400 italic mb-1">"{item.phrase}"</div>
                      <div className="text-sm text-stone-700">{item.plainEnglish}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Light & Thermal Guide */}
        {result.lightThermalGuide && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '250ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <Sun size={18} className="text-amber-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Light & Thermal</h3>
            </div>

            {result.lightThermalGuide.naturalLightSummary && (
              <p className="text-sm text-stone-700 leading-relaxed mb-5">
                {result.lightThermalGuide.naturalLightSummary}
              </p>
            )}

            <div className="flex flex-wrap gap-3 mb-5">
              {result.lightThermalGuide.sunExposure && result.lightThermalGuide.sunExposure !== 'Unknown' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  Sun: {result.lightThermalGuide.sunExposure}
                </span>
              )}
              {result.lightThermalGuide.thermalRisk && result.lightThermalGuide.thermalRisk !== 'Unknown' && (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                  result.lightThermalGuide.thermalRisk === 'Balanced'
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : result.lightThermalGuide.thermalRisk === 'Likely Cold'
                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : 'bg-orange-50 text-orange-700 border-orange-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    result.lightThermalGuide.thermalRisk === 'Balanced'
                      ? 'bg-green-400'
                      : result.lightThermalGuide.thermalRisk === 'Likely Cold'
                      ? 'bg-sky-400'
                      : 'bg-orange-400'
                  }`}></span>
                  {result.lightThermalGuide.thermalRisk}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-2 gap-4">
              {result.lightThermalGuide.summerComfort && (
                <div className="p-4 bg-stone-50 rounded-xl">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1.5">Summer</div>
                  <p className="text-sm text-stone-700">{result.lightThermalGuide.summerComfort}</p>
                </div>
              )}
              {result.lightThermalGuide.winterComfort && (
                <div className="p-4 bg-stone-50 rounded-xl">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1.5">Winter</div>
                  <p className="text-sm text-stone-700">{result.lightThermalGuide.winterComfort}</p>
                </div>
              )}
            </div>

            {result.lightThermalGuide.evidence && result.lightThermalGuide.evidence.length > 0 && (
              <div className="mt-4 pt-4 border-t border-stone-100">
                <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">
                  What we saw
                </div>
                <ul className="space-y-1">
                  {result.lightThermalGuide.evidence.map((item, i) => (
                    <li key={i} className="text-xs text-stone-500 flex items-start gap-2">
                      <span className="mt-1 w-1 h-1 rounded-full bg-stone-300 flex-shrink-0"></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Sale mode: Investment Potential & Affordability Check */}
        {result.reportMode === 'sale' && (result.investment_potential || result.affordability_check) && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '275ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <TrendingUp size={18} className="text-blue-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Investment & Affordability</h3>
            </div>

            {result.investment_potential && (
              <div className="mb-6">
                <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">Investment Outlook</div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {result.investment_potential.growth_outlook && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                      Growth: {result.investment_potential.growth_outlook}
                    </span>
                  )}
                  {result.investment_potential.rental_yield_estimate && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-stone-50 text-stone-700 border border-stone-200">
                      Est. Yield: {result.investment_potential.rental_yield_estimate}
                    </span>
                  )}
                </div>
                {result.investment_potential.capital_growth_5yr && (
                  <p className="text-sm text-stone-600 mb-3">{result.investment_potential.capital_growth_5yr}</p>
                )}
                {result.investment_potential.key_positives && result.investment_potential.key_positives.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-medium text-green-700 mb-1">Positives</div>
                    <ul className="space-y-1">
                      {result.investment_potential.key_positives.map((item, i) => (
                        <li key={i} className="text-xs text-stone-600 flex items-start gap-2">
                          <span className="mt-1 w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.investment_potential.key_concerns && result.investment_potential.key_concerns.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-amber-700 mb-1">Concerns</div>
                    <ul className="space-y-1">
                      {result.investment_potential.key_concerns.map((item, i) => (
                        <li key={i} className="text-xs text-stone-600 flex items-start gap-2">
                          <span className="mt-1 w-1 h-1 rounded-full bg-amber-400 flex-shrink-0"></span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {result.affordability_check && (
              <div className="pt-4 border-t border-stone-100">
                <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">Affordability Check</div>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  {result.affordability_check.estimated_deposit_20pct && (
                    <div className="p-3 bg-stone-50 rounded-xl">
                      <div className="text-[10px] text-stone-500 mb-1">Est. Deposit (20%)</div>
                      <div className="text-sm font-semibold text-stone-800">${result.affordability_check.estimated_deposit_20pct.toLocaleString()}</div>
                    </div>
                  )}
                  {result.affordability_check.estimated_loan && (
                    <div className="p-3 bg-stone-50 rounded-xl">
                      <div className="text-[10px] text-stone-500 mb-1">Est. Loan</div>
                      <div className="text-sm font-semibold text-stone-800">${result.affordability_check.estimated_loan.toLocaleString()}</div>
                    </div>
                  )}
                </div>
                {result.affordability_check.estimated_monthly_repayment && (
                  <p className="text-sm text-stone-700 mb-2">Est. repayment: {result.affordability_check.estimated_monthly_repayment}</p>
                )}
                {result.affordability_check.assessment && (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                    result.affordability_check.assessment === 'manageable' ? 'bg-green-50 text-green-700 border border-green-200' :
                    result.affordability_check.assessment === 'stretch' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                    'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {result.affordability_check.assessment === 'manageable' ? 'Manageable' :
                     result.affordability_check.assessment === 'stretch' ? 'A Stretch' : 'Challenging'}
                  </span>
                )}
                {result.affordability_check.note && (
                  <p className="text-xs text-stone-500 mt-2">{result.affordability_check.note}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Application Strategy (rent mode only) */}
        {result.reportMode !== 'sale' && result.applicationStrategy && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '300ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Send size={18} className="text-blue-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">How to Apply</h3>
            </div>

            {result.applicationStrategy.urgency && (
              <div className="mb-5">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  result.applicationStrategy.urgency === 'High'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : result.applicationStrategy.urgency === 'Medium'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-green-50 text-green-700 border-green-200'
                }`}>
                  {result.applicationStrategy.urgency === 'High' ? 'Act fast' : result.applicationStrategy.urgency === 'Medium' ? 'Apply soon' : 'Take your time'}
                </span>
              </div>
            )}

            {result.applicationStrategy.applySpeed && (
              <p className="text-sm text-stone-700 leading-relaxed mb-5">
                {result.applicationStrategy.applySpeed}
              </p>
            )}

            {result.applicationStrategy.checklist && result.applicationStrategy.checklist.length > 0 && (
              <div className="mb-5">
                <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">What to prepare</div>
                <div className="space-y-2">
                  {result.applicationStrategy.checklist.map((item, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-md bg-blue-50 border border-blue-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <SquareCheck size={12} className="text-blue-500" strokeWidth={2} />
                      </div>
                      <span className="text-sm text-stone-700 leading-snug">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.applicationStrategy.reasoning && result.applicationStrategy.reasoning.length > 0 && (
              <div className="pt-4 border-t border-stone-100">
                <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Why this timing</div>
                <ul className="space-y-1">
                  {result.applicationStrategy.reasoning.map((item, i) => (
                    <li key={i} className="text-xs text-stone-500 flex items-start gap-2">
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-stone-300 flex-shrink-0"></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ===== Sale 模式专属新卡片 ===== */}

        {/* Land Value Analysis (Sale mode) */}
        {result.reportMode === 'sale' && result.land_value_analysis && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '225ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <TrendingUp size={18} className="text-emerald-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Land Value Analysis</h3>
            </div>

            {result.land_value_analysis.landSize && result.land_value_analysis.pricePerSqm && (
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="p-4 bg-stone-50 rounded-xl">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1">Land Size</div>
                  <div className="text-lg font-semibold text-stone-800">
                    {result.land_value_analysis.landSize.toLocaleString()} sqm
                  </div>
                </div>
                <div className="p-4 bg-stone-50 rounded-xl">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1">Price per sqm</div>
                  <div className="text-lg font-semibold text-stone-800">
                    ${result.land_value_analysis.pricePerSqm.toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {result.land_value_analysis.landBankingPotential && (
              <div className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  Land Banking Potential
                </span>
              </div>
            )}

            {result.land_value_analysis.scarcityIndicator && (
              <div className="mb-4">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  result.land_value_analysis.scarcityIndicator === 'High'
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : result.land_value_analysis.scarcityIndicator === 'Low'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  Scarcity: {result.land_value_analysis.scarcityIndicator}
                </span>
              </div>
            )}

            {result.land_value_analysis.explanation && (
              <p className="text-sm text-stone-600 leading-relaxed">{result.land_value_analysis.explanation}</p>
            )}
          </div>
        )}

        {/* Holding Costs Breakdown (Sale mode) */}
        {result.reportMode === 'sale' && result.holding_costs && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px-8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '250ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <DollarSign size={18} className="text-amber-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Upfront Costs Breakdown</h3>
            </div>

            <div className="space-y-3 mb-5">
              {result.holding_costs.deposit20pct > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-600">Deposit (20%)</span>
                  <span className="text-sm font-semibold text-stone-800">${result.holding_costs.deposit20pct.toLocaleString()}</span>
                </div>
              )}
              {result.holding_costs.stampDuty > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-600">
                    Stamp Duty
                    {result.holding_costs.stampDutyState && result.holding_costs.stampDutyState !== 'Other' && (
                      <span className="text-xs text-stone-400 ml-1">({result.holding_costs.stampDutyState})</span>
                    )}
                  </span>
                  <span className="text-sm font-semibold text-stone-800">${result.holding_costs.stampDuty.toLocaleString()}</span>
                </div>
              )}
              {result.holding_costs.transferFees > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-600">Transfer Fees</span>
                  <span className="text-sm font-semibold text-stone-800">${result.holding_costs.transferFees.toLocaleString()}</span>
                </div>
              )}
              {result.holding_costs.legalCosts > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-600">Legal Costs</span>
                  <span className="text-sm font-semibold text-stone-800">${result.holding_costs.legalCosts.toLocaleString()}</span>
                </div>
              )}
              {result.holding_costs.inspectionCosts > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-600">Building & Pest</span>
                  <span className="text-sm font-semibold text-stone-800">${result.holding_costs.inspectionCosts.toLocaleString()}</span>
                </div>
              )}
            </div>

            {result.holding_costs.totalUpfrontCosts && result.holding_costs.totalUpfrontCosts > 0 && (
              <div className="pt-4 border-t-2 border-stone-200">
                <div className="flex justify-between items-center">
                  <span className="text-base font-semibold text-stone-800">Total Upfront</span>
                  <span className="text-lg font-bold text-stone-900">${result.holding_costs.totalUpfrontCosts.toLocaleString()}</span>
                </div>
              </div>
            )}

            {result.holding_costs.estimatedMonthlyRepayment && (
              <p className="text-sm text-stone-600 mt-4">
                Est. repayment: {result.holding_costs.estimatedMonthlyRepayment}
              </p>
            )}

            {result.holding_costs.cashFlowAnalysis && (
              <div className="mt-4 p-4 bg-stone-50 rounded-xl">
                <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Cash Flow Analysis</div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-600">Potential rent vs mortgage</span>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                    result.holding_costs.cashFlowAnalysis?.verdict === 'Positive Gearing'
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : result.holding_costs.cashFlowAnalysis?.verdict === 'Negative Gearing'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-stone-100 text-stone-700 border-stone-200'
                  }`}>
                    {result.holding_costs.cashFlowAnalysis?.verdict === 'Positive Gearing' ? 'Positive Gearing' :
                     result.holding_costs.cashFlowAnalysis?.verdict === 'Negative Gearing' ? 'Negative Gearing' : 'Neutral'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Red Flag Alerts (Sale mode) */}
        {result.reportMode === 'sale' && result.red_flag_alerts && result.red_flag_alerts.length > 0 && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '262ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertTriangle size={18} className="text-red-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Red Flag Alerts</h3>
            </div>

            <div className="space-y-3">
              {result.red_flag_alerts.map((alert, index) => (
                <div key={index} className={`p-4 rounded-xl border ${
                  alert.severity === 'high'
                    ? 'bg-red-50 border-red-200'
                    : alert.severity === 'medium'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-stone-50 border-stone-200'
                }`}>
                  <div className="flex items-start gap-3">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0 ${
                      alert.severity === 'high'
                        ? 'bg-red-500 text-white'
                        : alert.severity === 'medium'
                        ? 'bg-amber-500 text-white'
                        : 'bg-stone-400 text-white'
                    }`}>
                      {alert.severity === 'high' ? '!' : alert.severity === 'medium' ? '~' : 'i'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-stone-800">{alert.keyword}</span>
                        <span className="text-[10px] uppercase tracking-widest text-stone-500">{alert.category}</span>
                      </div>
                      <p className="text-sm text-stone-600 mb-2">{alert.message}</p>
                      {alert.action && (
                        <p className="text-xs text-stone-500 flex items-center gap-1">
                          <span className="text-stone-400">Action:</span> {alert.action}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* State-Specific Advice (Sale mode) */}
        {result.reportMode === 'sale' && result.state_specific_advice && result.state_specific_advice.recommendations && result.state_specific_advice.recommendations.length > 0 && (
          <div className="mb-10 bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '275ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Eye size={18} className="text-blue-600" strokeWidth={1.5} />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-stone-900">State-Specific Due Diligence</h3>
                {result.state_specific_advice.state && result.state_specific_advice.state !== 'Unknown' && (
                  <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-xs font-medium">
                    {result.state_specific_advice.state}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {result.state_specific_advice.recommendations.map((rec, index) => (
                <div key={index} className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
                  <div className="w-5 h-5 rounded-md bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Check size={12} className="text-blue-600" strokeWidth={2} />
                  </div>
                  <span className="text-sm text-stone-700 leading-relaxed">{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== Sale 模式专属新卡片 END ===== */}

        {/* Space Analysis */}
        {spaceAnalysis && spaceAnalysis.length > 0 && (
          <>
            <div className="mb-6 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '100ms' }}>
              <h2 className="text-xl font-semibold text-stone-900 mb-2">Space Analysis</h2>
              <p className="text-sm text-stone-500">Condition assessment for each area</p>
            </div>
            <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-3 @container[size>=700px]:grid-cols-4 gap-4">
              {spaceAnalysis.map((space, index) => (
                <div key={index} className="bg-white rounded-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.06)] border border-stone-200/70 animate-in fade-in slide-in-from-bottom-8 duration-500 ease-out" style={{ animationDelay: `${150 + index * 50}ms` }}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
                        {getSpaceTypeLabel(space.spaceType)}
                      </div>
                      {space.explanation && (
                        <div className="text-xs text-stone-500 mt-1 line-clamp-2">
                          {space.explanation}
                        </div>
                      )}
                      <div className="text-xs text-stone-400 mt-1">
                        {space.photoCount} photo{space.photoCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className={`text-4xl font-semibold leading-none tracking-tight ${getScoreColor(space.score)}`}>
                      {space.score}
                    </div>
                  </div>
                  <div className="h-px bg-stone-200/70 my-4"></div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-400 mb-3">
                    Key observations
                  </div>
                  <ul className="space-y-1.5">
                    {(space.observations || []).slice(0, 3).map((obs, i) => (
                      <li key={i} className="text-sm text-stone-600 leading-relaxed">
                        • {obs}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <SectionDivider />
          </>
        )}

        {/* Property Strengths + Potential Issues */}
        <div className="grid grid-cols-1 @container[size>=700px]:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '200ms' }}>
          <div className="bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                <Check size={18} className="text-green-600" strokeWidth={2} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Property Strengths</h3>
            </div>
            <BulletList items={result.propertyStrengths || result.whatLooksGood} />
          </div>

          <div className="bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertCircle size={18} className="text-red-600" strokeWidth={2} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Potential Issues</h3>
            </div>
            <BulletList items={result.potentialIssues || result.riskSignals} />
          </div>
        </div>

        {/* Potential Risks */}
        {result.risks && result.risks.length > 0 && (
          <>
            <SectionDivider />
            <div className="bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '250ms' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <AlertTriangle size={18} className="text-amber-600" strokeWidth={2} />
                </div>
                <h3 className="text-base font-semibold text-stone-900">Potential Risks</h3>
              </div>
              <div className="space-y-3">
                {risks.slice(0, 3).map((risk, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl">
                    <span className="text-amber-600 text-sm font-medium shrink-0">!</span>
                    <span className="text-sm text-stone-700 leading-relaxed">{risk}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <SectionDivider />

        {/* Competition Risk */}
        {competitionRisk && (
          <>
            <div className="bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '300ms' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
                  <TrendingUp size={18} className="text-stone-600" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-semibold text-stone-900">Competition Risk</h3>
              </div>
              <div className="flex flex-col @container[size>=480px]:flex-row @container[size>=480px]:items-start gap-6">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${competitionConfig[competitionRisk.level]?.bgColor || competitionConfig.MEDIUM.bgColor} ${competitionConfig[competitionRisk.level]?.color || competitionConfig.MEDIUM.color} border ${competitionConfig[competitionRisk.level]?.borderColor || competitionConfig.MEDIUM.borderColor}`}>
                  <span className="w-2 h-2 rounded-full bg-current"></span>
                  {competitionConfig[competitionRisk.level]?.label || 'Unknown'}
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">Reasons</div>
                  <SimpleBulletList items={competitionRisk.reasons} />
                </div>
              </div>
            </div>
            <SectionDivider />
          </>
        )}

        {/* Next Move / Recommendation - Sale mode enhanced with Next Move */}
        {result.reportMode === 'sale' && (result.next_move || recommendation) && (
          <>
            <div className="bg-stone-900 text-white rounded-3xl p-6 @container[size>=480px]:p-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '400ms' }}>
              {/* Next Move Header */}
              {result.next_move && (
                <>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center">
                      <ArrowRight size={18} className="text-amber-400" strokeWidth={1.5} />
                    </div>
                    <h3 className="text-base font-semibold text-white">Next Move</h3>
                    {/* Decision Badge */}
                    <span className={`ml-auto px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border ${
                      result.next_move.decision === 'PROCEED'
                        ? 'bg-green-500/30 text-green-300 border-green-500/50'
                        : result.next_move.decision === 'SKIP'
                        ? 'bg-red-500/30 text-red-300 border-red-500/50'
                        : 'bg-amber-500/30 text-amber-300 border-amber-500/50'
                    }`}>
                      {result.next_move.decision === 'PROCEED' ? 'Proceed' : result.next_move.decision === 'SKIP' ? 'Skip' : 'Proceed with Caution'}
                    </span>
                  </div>

                  {/* Next Move Headline */}
                  {result.next_move.headline && (
                    <div className="mb-6">
                      <p className={`text-xl font-semibold ${
                        result.next_move.decision === 'PROCEED' ? 'text-green-300' :
                        result.next_move.decision === 'SKIP' ? 'text-red-300' : 'text-amber-300'
                      }`}>
                        {result.next_move.headline}
                      </p>
                    </div>
                  )}

                  {/* Next Move Reasoning */}
                  {result.next_move.reasoning && (
                    <p className="text-sm text-stone-300 leading-relaxed mb-6">
                      {result.next_move.reasoning}
                    </p>
                  )}

                  {/* Suggested Actions */}
                  {result.next_move.suggested_actions && result.next_move.suggested_actions.length > 0 && (
                    <div className="mb-6">
                      <div className="text-[10px] font-medium uppercase tracking-widest text-stone-400 mb-3">Suggested Actions</div>
                      <div className="flex flex-wrap gap-2">
                        {result.next_move.suggested_actions.map((action, i) => (
                          <span key={i} className="px-3 py-1.5 bg-white/10 text-white/90 text-xs rounded-full">
                            {action}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="h-px bg-white/10 my-6"></div>
                </>
              )}

              {/* Fallback to old recommendation if no next_move */}
              {!result.next_move && (
                <>
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center">
                      <AlertTriangle size={18} className="text-amber-400" strokeWidth={1.5} />
                    </div>
                    <h3 className="text-base font-semibold text-white">Recommendation</h3>
                  </div>
                  <div className="mb-8">
                    <span className="text-[10px] font-medium uppercase tracking-widest text-stone-400 mb-2 block">Decision</span>
                    <span className={`text-2xl font-semibold ${config.color.replace('text-', 'text-').replace('600', '400')}`}>
                      {recommendation.verdict}
                    </span>
                  </div>
                </>
              )}

              {/* Good Fit / Not Ideal - show if available */}
              <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-2 gap-8">
                {(result.inspectionFit?.good_for && result.inspectionFit.good_for.length > 0) || (recommendation?.goodFitIf && recommendation.goodFitIf.length > 0) ? (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-widest text-green-400 mb-3">Good Fit For</div>
                    <SimpleBulletList items={result.inspectionFit?.good_for || recommendation?.goodFitIf || []} className="text-white" />
                  </div>
                ) : null}
                {(result.inspectionFit?.not_ideal_for && result.inspectionFit.not_ideal_for.length > 0) || (recommendation?.notIdealIf && recommendation.notIdealIf.length > 0) ? (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-widest text-red-400 mb-3">Not Ideal For</div>
                    <SimpleBulletList items={result.inspectionFit?.not_ideal_for || recommendation?.notIdealIf || []} className="text-white" />
                  </div>
                ) : null}
              </div>
            </div>
            <SectionDivider />
          </>
        )}

        {/* Legacy Recommendation - Only show for non-sale mode */}
        {result.reportMode !== 'sale' && recommendation && (
          <>
            <div className="bg-stone-900 text-white rounded-3xl p-6 @container[size>=480px]:p-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '400ms' }}>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center">
                  <AlertTriangle size={18} className="text-amber-400" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-semibold text-white">Recommendation</h3>
              </div>

              <div className="mb-8">
                <span className="text-[10px] font-medium uppercase tracking-widest text-stone-400 mb-2 block">Decision</span>
                <span className={`text-2xl font-semibold ${config.color.replace('text-', 'text-').replace('600', '400')}`}>
                  {recommendation.verdict}
                </span>
              </div>

              <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-2 gap-8">
                {(result.inspectionFit?.good_for && result.inspectionFit.good_for.length > 0) || (recommendation.goodFitIf && recommendation.goodFitIf.length > 0) ? (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-widest text-green-400 mb-3">Good Fit For</div>
                    <SimpleBulletList items={result.inspectionFit?.good_for || recommendation.goodFitIf} className="text-white" />
                  </div>
                ) : null}
                {(result.inspectionFit?.not_ideal_for && result.inspectionFit.not_ideal_for.length > 0) || (recommendation.notIdealIf && recommendation.notIdealIf.length > 0) ? (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-widest text-red-400 mb-3">Not Ideal For</div>
                    <SimpleBulletList items={result.inspectionFit?.not_ideal_for || recommendation.notIdealIf} className="text-white" />
                  </div>
                ) : null}
              </div>
            </div>
            <SectionDivider />
          </>
        )}

        {/* Questions to Ask */}
          <div className="bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '500ms' }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
              <MessageCircle size={18} className="text-stone-600" strokeWidth={1.5} />
            </div>
            <h3 className="text-base font-semibold text-stone-900">Questions to Ask</h3>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {questionsToAsk.slice(0, 3).map((question, index) => (
              <div key={index} className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
                <span className="text-stone-400 text-sm font-medium shrink-0">Q{index + 1}.</span>
                <span className="text-sm text-stone-700 leading-relaxed">{question}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Reality Check */}
        {result.reality_check?.should_display === true && (
          <>
            <SectionDivider />
            <div className="bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '550ms' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                  <Eye size={18} className="text-purple-600" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-semibold text-stone-900">Reality Check</h3>
              </div>

              {result.reality_check.summary && (
                <div className="mb-6">
                  <p className="text-sm text-stone-700 leading-relaxed">{result.reality_check.summary}</p>
                </div>
              )}

              {result.reality_check.overall_verdict && (
                <div className="mb-6">
                  <span className={`inline-flex items-center px-4 py-2 rounded-full text-xs font-semibold ${
                    result.reality_check.overall_verdict === 'Mostly factual'
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : result.reality_check.overall_verdict === 'Some promotional wording'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {result.reality_check.overall_verdict}
                  </span>
                </div>
              )}

              {result.reality_check && result.reality_check.marketing_phrases && result.reality_check.marketing_phrases.length > 0 && (
                <div className="mb-6">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">Promotional Language Found</div>
                  <div className="flex flex-wrap gap-2">
                    {result.reality_check.marketing_phrases.slice(0, 5).map((phrase, index) => (
                      <span key={index} className="px-3 py-1.5 bg-stone-100 text-stone-600 text-sm rounded-lg">
                        "{phrase}"
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result.reality_check && result.reality_check.missing_specifics && result.reality_check.missing_specifics.length > 0 && (
                <div className="mb-6">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">Missing Details</div>
                  <SimpleBulletList items={result.reality_check.missing_specifics.slice(0, 5)} />
                </div>
              )}

              {result.reality_check && result.reality_check.support_gaps && result.reality_check.support_gaps.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">Claims Without Visual Support</div>
                  <SimpleBulletList items={result.reality_check.support_gaps.slice(0, 3)} />
                </div>
              )}
            </div>
          </>
        )}

        {/* Upgrade Prompt - For basic analysis only */}
        {result.upgradePrompt && onUpgrade && (
          <div className="mt-12 mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
            <div className="bg-gradient-to-br from-stone-900 to-stone-800 rounded-3xl p-6 text-white">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Zap className="w-6 h-6 text-yellow-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-2">{result.upgradePrompt.title}</h3>
                  <ul className="text-sm text-stone-300 space-y-1.5 mb-5">
                    {result.upgradePrompt.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={onUpgrade}
                    className="w-full bg-white text-stone-900 font-semibold py-3 px-5 rounded-xl hover:bg-stone-100 transition-colors"
                  >
                    Try Deep Analysis (uses 1 credit)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Bottom */}
        <div className="flex flex-col items-center pt-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '600ms' }}>
          <button
            onClick={onBack}
            className="group relative inline-flex items-center justify-center gap-3 px-10 py-4 rounded-full transition-all duration-300 shadow-[0_8px_30px_rgba(28,25,23,0.15)] hover:shadow-[0_8px_30px_rgba(28,25,23,0.25)] hover:-translate-y-0.5 bg-stone-900 hover:bg-stone-800 text-white"
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.15em]">Analyze Another Listing</span>
            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" strokeWidth={2} />
          </button>

          {onShare && (
            <div className="mt-10 flex flex-col items-center gap-4">
              {isPublicShare ? (
                <p className="text-sm font-medium text-stone-500 text-center">
                  Share this analysis with friends or save it for later.
                </p>
              ) : (
                <p className="text-sm font-medium text-stone-500 text-center">
                  Big decision — worth getting a second opinion before you move forward.
                </p>
              )}
              {!shareResult ? (
                <button
                  onClick={handleShare}
                  disabled={isSharing}
                  className="group relative inline-flex items-center justify-center gap-2 px-6 py-3 bg-stone-100 text-stone-600 rounded-full transition-all duration-300 hover:bg-stone-200 disabled:opacity-50"
                >
                  <Share2 size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em]">
                    {isSharing ? 'Generating share link...' : 'Share report'}
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full">
                  {copied ? (
                    <>
                      <CheckCircle size={14} />
                      <span className="text-xs font-medium">Copied!</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={14} />
                      <span className="text-xs font-medium">Link copied!</span>
                      <button
                        onClick={copyToClipboard}
                        className="ml-1 p-1 hover:bg-green-100 rounded"
                        title="Copy link"
                      >
                        <Copy size={12} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
