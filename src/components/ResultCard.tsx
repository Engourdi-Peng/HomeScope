import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../types';
import { Check, AlertCircle, ArrowRight, ArrowLeft, Home as HomeIcon, TrendingUp, AlertTriangle, MessageCircle, Eye } from 'lucide-react';

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
          <span className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${darkCard ? 'bg-[#B3B3B3]' : 'bg-stone-400'}`}></span>
          <span className={`text-sm leading-relaxed ${darkCard ? 'text-[#B3B3B3]' : 'text-stone-600'}`}>{item}</span>
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
          <span className="text-xs font-medium uppercase tracking-widest">Back to Scanner</span>
        </button>
        
        <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 bg-white/70 backdrop-blur-md px-4 py-1.5 rounded-full border border-stone-200 flex items-center gap-2">
          <HomeIcon size={10} /> Analysis Complete
        </div>
      </div>

      <div className="space-y-0">
        
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
              <div className="mt-5 px-4 py-2 rounded-full text-[11px] font-normal bg-[#4D3620] text-[#FFA64B] border border-[#FFA64B]/80">
                {config.label}
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
            <div className="bg-stone-900 text-stone-100 rounded-3xl p-10 md:p-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '400ms' }}>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center">
                  <AlertTriangle size={18} className="text-amber-400" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-semibold text-stone-100">Recommendation</h3>
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
                    <SimpleBulletList items={result.inspectionFit?.good_for || recommendation.goodFitIf} className="text-stone-300" />
                  </div>
                ) : null}
                {(result.inspectionFit?.not_ideal_for && result.inspectionFit.not_ideal_for.length > 0) || (recommendation.notIdealIf && recommendation.notIdealIf.length > 0) ? (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-widest text-red-400 mb-3">Not Ideal For</div>
                    <SimpleBulletList items={result.inspectionFit?.not_ideal_for || recommendation.notIdealIf} className="text-stone-300" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {result.questionsToAsk.slice(0, 6).map((question, index) => (
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
