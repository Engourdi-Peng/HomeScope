import { CheckCircle, AlertTriangle, XCircle, HelpCircle, Share2, ArrowLeft, TrendingUp, Users, DollarSign, MessageSquare } from 'lucide-react';
import type { AnalysisResult } from '../types/analysis';

export interface ResultCardProps {
  result: AnalysisResult;
  onBack?: () => void;
  onShare?: (analysisId: string) => Promise<string>;
}

// ===== verdict 配置 =====
const verdictConfig = {
  'Worth Inspecting': {
    icon: CheckCircle,
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    badgeBg: 'bg-green-100 text-green-800',
  },
  'Proceed With Caution': {
    icon: AlertTriangle,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    badgeBg: 'bg-amber-100 text-amber-800',
  },
  'Likely Overpriced / Risky': {
    icon: XCircle,
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    badgeBg: 'bg-red-100 text-red-800',
  },
  'Need More Evidence': {
    icon: HelpCircle,
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    badgeBg: 'bg-blue-100 text-blue-800',
  },
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = score >= 75 ? 'bg-green-500' : score >= 55 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-5xl font-black text-stone-900 tracking-tight">{score}</span>
        <span className="text-lg text-stone-400 font-medium">/ 100</span>
      </div>
      <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-stone-100 bg-stone-50">
        <Icon className="w-4 h-4 text-stone-500" />
        <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function ResultCard({ result, onBack, onShare }: ResultCardProps) {
  const vc = verdictConfig[result.verdict] ?? verdictConfig['Need More Evidence'];
  const VerdictIcon = vc.icon;

  const competitionRisk = result.competitionRisk;
  const rentFairness = result.rent_fairness;
  const inspectionFit = result.inspectionFit;
  const agentQuestions = result.agentQuestions ?? result.questionsToAsk ?? [];
  const hiddenRisks = result.hiddenRisks ?? [];
  const strengths = result.whatLooksGood ?? [];
  const risks = result.risks ?? result.riskSignals ?? [];
  const australiaInsights = result.australiaInsights;
  const spaceAnalysis = result.spaceAnalysis ?? [];

  const handleShare = async () => {
    if (!onShare) return;
    try {
      const analysisId = result.id;
      if (!analysisId) return;
      const shareUrl = await onShare(analysisId);
      await navigator.clipboard.writeText(shareUrl);
      alert('Share link copied to clipboard!');
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  return (
    <div className="space-y-5">
      {/* 头部：评分 + 定论 + 导航 */}
      <div className={`${vc.bgColor} border ${vc.borderColor} rounded-2xl p-6`}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className={`flex items-center gap-3 ${vc.color}`}>
            <VerdictIcon className="w-7 h-7 flex-shrink-0" />
            <span className="text-xl font-bold leading-tight">{result.verdict}</span>
          </div>
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/80"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            )}
            {onShare && (
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/80"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            )}
          </div>
        </div>

        <ScoreBar score={result.overallScore} />

        {result.quickSummary && (
          <p className="mt-4 text-stone-700 leading-relaxed">{result.quickSummary}</p>
        )}

        {/* 分析元数据 */}
        <div className="flex flex-wrap gap-3 mt-4">
          {result.decisionPriority && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              result.decisionPriority === 'HIGH'
                ? 'bg-red-50 text-red-700 border-red-200'
                : result.decisionPriority === 'MEDIUM'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-stone-100 text-stone-600 border-stone-200'
            }`}>
              Priority: {result.decisionPriority}
            </span>
          )}
          {result.confidenceLevel && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
              Confidence: {result.confidenceLevel}
            </span>
          )}
          {result.analyzedPhotoCount !== undefined && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
              {result.analyzedPhotoCount} photos
            </span>
          )}
          {result.detectedRooms && result.detectedRooms.length > 0 && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
              {result.detectedRooms.join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* 优点 + 缺点 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {strengths.length > 0 && (
          <SectionCard title="What Looks Good" icon={CheckCircle}>
            <ul className="space-y-2">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                  <span className="text-green-500 flex-shrink-0 mt-0.5">✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
        {risks.length > 0 && (
          <SectionCard title="Watch Out For" icon={AlertTriangle}>
            <ul className="space-y-2">
              {risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                  <span className="text-red-500 flex-shrink-0 mt-0.5">⚠</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      {/* 隐藏风险 */}
      {hiddenRisks.length > 0 && (
        <SectionCard title="Hidden Risks" icon={XCircle}>
          <ul className="space-y-2">
            {hiddenRisks.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                <span className="text-red-500 flex-shrink-0 mt-0.5">✗</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* 竞争风险 */}
      {competitionRisk && (
        <SectionCard title="Competition" icon={TrendingUp}>
          <div className="flex items-center gap-3 mb-3">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
              competitionRisk.level === 'HIGH'
                ? 'bg-red-100 text-red-700 border-red-300'
                : competitionRisk.level === 'MEDIUM'
                ? 'bg-amber-100 text-amber-700 border-amber-300'
                : 'bg-green-100 text-green-700 border-green-300'
            }`}>
              {competitionRisk.level} Competition
            </span>
          </div>
          {competitionRisk.reasons.length > 0 && (
            <ul className="space-y-1.5">
              {competitionRisk.reasons.map((r, i) => (
                <li key={i} className="text-sm text-stone-600">— {r}</li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* 租金评估 */}
      {rentFairness && (
        <SectionCard title="Rent Verdict" icon={DollarSign}>
          <div className="flex flex-wrap gap-3 mb-3">
            <span className="text-sm font-semibold text-stone-700">
              Listed: <strong>${rentFairness.listing_price}/wk</strong>
            </span>
            {rentFairness.estimated_min && rentFairness.estimated_max && (
              <span className="text-sm text-stone-500">
                Typical: <strong>${rentFairness.estimated_min}–${rentFairness.estimated_max}/wk</strong>
              </span>
            )}
          </div>
          {rentFairness.verdict && (
            <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full mb-2 ${
              rentFairness.verdict.includes('overpriced') || rentFairness.verdict.includes('high')
                ? 'bg-red-100 text-red-700'
                : rentFairness.verdict.includes('fair') || rentFairness.verdict.includes('under')
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {rentFairness.verdict.replace(/_/g, ' ')}
            </span>
          )}
          {rentFairness.explanation && (
            <p className="text-sm text-stone-600 leading-relaxed">{rentFairness.explanation}</p>
          )}
        </SectionCard>
      )}

      {/* 适合人群 */}
      {inspectionFit && (
        <SectionCard title="Fit Assessment" icon={Users}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {inspectionFit.good_for.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-2">Good for</p>
                <ul className="space-y-1.5">
                  {inspectionFit.good_for.map((g, i) => (
                    <li key={i} className="text-sm text-stone-600 flex items-start gap-2">
                      <span className="text-green-500 flex-shrink-0">✓</span>
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inspectionFit.not_ideal_for.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-2">Not ideal for</p>
                <ul className="space-y-1.5">
                  {inspectionFit.not_ideal_for.map((n, i) => (
                    <li key={i} className="text-sm text-stone-600 flex items-start gap-2">
                      <span className="text-red-500 flex-shrink-0">✗</span>
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* 中介问题 */}
      {agentQuestions.length > 0 && (
        <SectionCard title="Questions to Ask the Agent" icon={MessageSquare}>
          <ul className="space-y-3">
            {agentQuestions.map((q, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="flex-shrink-0 w-6 h-6 bg-stone-100 text-stone-600 text-xs font-bold rounded-full flex items-center justify-center mt-0.5">
                  Q{i + 1}
                </span>
                <span className="text-stone-700 leading-relaxed">{q}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* 房间分析 */}
      {spaceAnalysis.length > 0 && (
        <SectionCard title="Room-by-Room Breakdown" icon={CheckCircle}>
          <div className="space-y-4">
            {spaceAnalysis.map((space, i) => (
              <div key={i} className="border-b border-stone-100 last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-stone-800 capitalize">{space.spaceType}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          space.score >= 75 ? 'bg-green-500' : space.score >= 55 ? 'bg-amber-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${space.score}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-stone-500">{space.score}</span>
                  </div>
                </div>
                {space.explanation && (
                  <p className="text-xs text-stone-500 leading-relaxed">{space.explanation}</p>
                )}
                {space.observations.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {space.observations.slice(0, 2).map((o, j) => (
                      <li key={j} className="text-xs text-stone-400 flex items-start gap-1">
                        <span>–</span>
                        <span>{o}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 澳洲特色洞察 */}
      {australiaInsights && (
        <SectionCard title="Australian Insights" icon={CheckCircle}>
          {australiaInsights.smartTags && australiaInsights.smartTags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {australiaInsights.smartTags.map((tag, i) => (
                <span key={i} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {australiaInsights.redFlagDetector && australiaInsights.redFlagDetector.flags.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-red-700 uppercase tracking-wider mb-2">Red Flags</p>
              <ul className="space-y-1">
                {australiaInsights.redFlagDetector.flags.map((f, i) => (
                  <li key={i} className="text-sm text-red-600 flex items-start gap-2">
                    <span>🚩</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {australiaInsights.trueCost && (
            <div className="mb-4">
              <p className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">True Cost</p>
              <p className="text-sm text-stone-700">
                <strong>${australiaInsights.trueCost.weekly}/week</strong>
                <span className="text-stone-400"> · ${australiaInsights.trueCost.annual}/year</span>
              </p>
              {australiaInsights.trueCost.notes.map((n, i) => (
                <p key={i} className="text-xs text-stone-400">— {n}</p>
              ))}
            </div>
          )}
          {australiaInsights.agentTranslation && australiaInsights.agentTranslation.length > 0 && (
            <div>
              <p className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">What Agents Really Mean</p>
              <ul className="space-y-2">
                {australiaInsights.agentTranslation.map((t, i) => (
                  <li key={i} className="text-sm">
                    <span className="text-stone-500 italic">"{t.phrase}"</span>
                    <br />
                    <span className="text-stone-700">→ {t.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
