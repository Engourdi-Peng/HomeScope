import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../types';
import { Check, AlertCircle, ArrowRight, ArrowLeft, TrendingUp, AlertTriangle, MessageCircle, Eye, DollarSign } from 'lucide-react';

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
          <span className="text-stone-600 text-sm leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionDivider() {
  return <div className="h-px bg-stone-200 my-14"></div>;
}

export function ResultCard({ result, onBack }: ResultProps) {
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
  const detectedSpaceCount = detectedRooms.length;

  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-12 duration-700 ease-out pb-24 relative z-10">
      
      {/* Header / Navigation */}
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
        
        {/* Logo - 居中 */}
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

      <div className="space-y-0">
        
        {/* 0. 报告摘要 - 仅标题 + 摘要正文，不展示 verdict 字段 */}
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

        {/* 1. Overall Score - Hero Card */}
        <div className="bg-[#282828] rounded-3xl p-10 md:p-14 shadow-[0_8px_40px_rgba(0,0,0,0.20)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
          <div className="flex flex-col lg:flex-row lg:items-center gap-12">
            {/* Score Section */}
            <div className="flex flex-col items-center lg:items-start lg:w-56 shrink-0">
              <div className="text-[10px] font-medium uppercase tracking-widest text-[#B3B3B3] mb-3">
                Overall Score
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-8xl md:text-9xl font-light tracking-tight text-white">
                  <AnimatedNumber target={result.overallScore} />
                </span>
                <span className="text-3xl md:text-4xl font-light text-[#B3B3B3]">/100</span>
              </div>
              {/* Decision Priority Tag */}
              <div className={`mt-4 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                result.decisionPriority === 'HIGH' ? 'bg-green-500/20 text-green-400 border border-green-500/40' :
                result.decisionPriority === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
                'bg-red-500/20 text-red-400 border border-red-500/40'
              }`}>
                {result.decisionPriority} PRIORITY
              </div>
            </div>

            {/* Divider */}
            <div className="hidden lg:block w-px h-44 bg-stone-600/70"></div>

            {/* Verdict & Pros/Cons */}
            <div className="flex-1">
              <div className="text-xs font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Verdict</div>
              <p className="text-xl md:text-2xl font-medium text-white leading-snug mb-6">{result.quickSummary}</p>

              {/* AI Confidence */}
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-[#BDBDBD] shrink-0">
                    AI Confidence
                  </div>
                  <div className="h-4 w-px bg-white/10"></div>
                  <div className={`text-xs font-semibold ${
                    result.confidenceLevel === 'High' ? 'text-green-400' :
                    result.confidenceLevel === 'Medium' ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {result.confidenceLevel}
                  </div>
                </div>
                <div className="text-[10px] text-[#888888] mt-2">
                  Based on number of listing photos and description.
                </div>
              </div>

              {/* Score Context - Market Position */}
              {result.scoreContext && (
                <div className="mb-6">
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
                  {result.scoreContext.explanation && (
                    <div className="text-[10px] text-[#888888] mt-2">
                      {result.scoreContext.explanation}
                    </div>
                  )}
                </div>
              )}

              {(typeof analyzedPhotoCount === 'number' || detectedRooms.length > 0) && (
                <div className="mb-6">
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-[#BDBDBD] shrink-0">
                      Understood
                    </div>
                    <div className="h-4 w-px bg-white/10"></div>
                    <div className="space-y-0.5 text-xs text-[#D6D6D6]">
                    {typeof analyzedPhotoCount === 'number' && (
                      <div>
                        Analyzed {analyzedPhotoCount} screenshot{analyzedPhotoCount === 1 ? '' : 's'}
                        {detectedSpaceCount > 0 ? ` across ${detectedSpaceCount} space${detectedSpaceCount === 1 ? '' : 's'}` : ''}
                      </div>
                    )}
                    {detectedRoomsText && <div>Detected {detectedRoomsText}</div>}
                    </div>
                  </div>
                </div>
              )}

              <div className="h-px bg-white/10 my-7"></div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Pros</div>
                  <BulletList items={result.whatLooksGood.slice(0, 4)} darkCard />
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-3">Cons</div>
                  <BulletList items={result.riskSignals.slice(0, 4)} darkCard />
                </div>
              </div>

              {/* Hidden Risk Signals */}
              {result.hiddenRisks && result.hiddenRisks.length > 0 && (
                <div className="mt-8">
                  <div className="h-px bg-white/10 mb-7"></div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-red-400 mb-3">Hidden Risk Signals</div>
                  <BulletList items={result.hiddenRisks.slice(0, 3)} darkCard />
                </div>
              )}
            </div>
          </div>
        </div>

        <SectionDivider />

        {/* 1.5. Rent Fairness - 放在 Overall Score 之后 */}
        {result.rent_fairness && (
          <div className="bg-white rounded-3xl p-8 md:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '150ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
                <DollarSign size={18} className="text-stone-600" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Rent Fairness</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Estimated Market Range */}
              <div className="p-4 bg-stone-50 rounded-xl">
                <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Estimated Market Range</div>
                <div className="text-xl font-semibold text-stone-800">
                  ${result.rent_fairness.estimated_min} – ${result.rent_fairness.estimated_max}
                  <span className="text-sm font-normal text-stone-500 ml-1">/ week</span>
                </div>
              </div>

              {/* Listing Price */}
              <div className="p-4 bg-stone-50 rounded-xl">
                <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Listing Price</div>
                <div className="text-xl font-semibold text-stone-800">
                  ${result.rent_fairness.listing_price}
                  <span className="text-sm font-normal text-stone-500 ml-1">/ week</span>
                </div>
              </div>
            </div>

            {/* Verdict */}
            <div className="mb-4">
              <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${rentFairnessConfig[result.rent_fairness.verdict]?.bgColor || rentFairnessConfig.fair.bgColor} ${rentFairnessConfig[result.rent_fairness.verdict]?.color || rentFairnessConfig.fair.color} border ${rentFairnessConfig[result.rent_fairness.verdict]?.borderColor || rentFairnessConfig.fair.borderColor}`}>
                {rentFairnessConfig[result.rent_fairness.verdict]?.label || 'Fair'}
              </span>
            </div>

            {/* Explanation */}
            {result.rent_fairness.explanation && (
              <p className="text-sm text-stone-600 leading-relaxed">{result.rent_fairness.explanation}</p>
            )}
          </div>
        )}

        {/* 2. Space Analysis */}
        {spaceAnalysis && spaceAnalysis.length > 0 && (
          <>
            <div className="mb-6 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '100ms' }}>
              <h2 className="text-xl font-semibold text-stone-900 mb-2">Space Analysis</h2>
              <p className="text-sm text-stone-500">Condition assessment for each area</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
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
                    {space.observations.slice(0, 3).map((obs, i) => (
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

        {/* 3. Property Strengths + Potential Issues */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '200ms' }}>
          {/* Property Strengths */}
          <div className="bg-white rounded-3xl p-8 md:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                <Check size={18} className="text-green-600" strokeWidth={2} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Property Strengths</h3>
            </div>
            <BulletList items={result.propertyStrengths || result.whatLooksGood} />
          </div>

          {/* Potential Issues */}
          <div className="bg-white rounded-3xl p-8 md:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertCircle size={18} className="text-red-600" strokeWidth={2} />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Potential Issues</h3>
            </div>
            <BulletList items={result.potentialIssues || result.riskSignals} />
          </div>
        </div>

        {/* Potential Risks - New Section */}
        {result.risks && result.risks.length > 0 && (
          <>
            <SectionDivider />
            <div className="bg-white rounded-3xl p-8 md:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '250ms' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <AlertTriangle size={18} className="text-amber-600" strokeWidth={2} />
                </div>
                <h3 className="text-base font-semibold text-stone-900">Potential Risks</h3>
              </div>
              <div className="space-y-3">
                {result.risks.slice(0, 3).map((risk, index) => (
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

        {/* 4. Competition Risk */}
        {competitionRisk && (
          <>
            <div className="bg-white rounded-3xl p-8 md:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '300ms' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
                  <TrendingUp size={18} className="text-stone-600" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-semibold text-stone-900">Competition Risk</h3>
              </div>
              <div className="flex flex-col md:flex-row md:items-start gap-6">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${competitionConfig[competitionRisk.level].bgColor} ${competitionConfig[competitionRisk.level].color} border ${competitionConfig[competitionRisk.level].borderColor}`}>
                  <span className="w-2 h-2 rounded-full bg-current"></span>
                  {competitionConfig[competitionRisk.level].label}
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

        {/* 5. Recommendation */}
        {recommendation && (
          <>
            <div className="bg-stone-900 text-white rounded-3xl p-10 md:p-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '400ms' }}>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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

        {/* 6. Questions to Ask */}
        <div className="bg-white rounded-3xl p-8 md:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '500ms' }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
              <MessageCircle size={18} className="text-stone-600" strokeWidth={1.5} />
            </div>
            <h3 className="text-base font-semibold text-stone-900">Questions to Ask</h3>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {(result.agentQuestions || result.questionsToAsk).slice(0, 3).map((question, index) => (
              <div key={index} className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
                <span className="text-stone-400 text-sm font-medium shrink-0">Q{index + 1}.</span>
                <span className="text-sm text-stone-700 leading-relaxed">{question}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 7. Reality Check - Only show if should_display === true */}
        {result.reality_check?.should_display === true && (
          <>
            <SectionDivider />
            <div className="bg-white rounded-3xl p-8 md:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '550ms' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                  <Eye size={18} className="text-purple-600" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-semibold text-stone-900">Reality Check</h3>
              </div>

              {/* Summary */}
              {result.reality_check.summary && (
                <div className="mb-6">
                  <p className="text-sm text-stone-700 leading-relaxed">{result.reality_check.summary}</p>
                </div>
              )}

              {/* Overall Verdict Tag */}
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

              {/* Marketing Phrases */}
              {result.reality_check.marketing_phrases && result.reality_check.marketing_phrases.length > 0 && (
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

              {/* Missing Specifics */}
              {result.reality_check.missing_specifics && result.reality_check.missing_specifics.length > 0 && (
                <div className="mb-6">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">Missing Details</div>
                  <SimpleBulletList items={result.reality_check.missing_specifics.slice(0, 5)} />
                </div>
              )}

              {/* Support Gaps */}
              {result.reality_check.support_gaps && result.reality_check.support_gaps.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-3">Claims Without Visual Support</div>
                  <SimpleBulletList items={result.reality_check.support_gaps.slice(0, 3)} />
                </div>
              )}
            </div>
          </>
        )}

        {/* Action Bottom */}
        <div className="flex flex-col items-center pt-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '600ms' }}>
          <button 
            onClick={onBack}
            className="group relative inline-flex items-center justify-center gap-3 px-10 py-4 bg-white text-stone-800 rounded-full transition-all duration-300 hover:bg-stone-50 hover:-translate-y-0.5 shadow-[0_1px_8px_rgba(0,0,0,0.06)]"
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.15em]">Analyze Another Listing</span>
            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" strokeWidth={2} />
          </button>
        </div>

      </div>
    </div>
  );
}
