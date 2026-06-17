/**
 * PhotoSpaceAnalysisCard — 共享组件
 * 被 NewReportUI (网站主链路) 和 USSaleReport (extension 备用链路) 共用。
 * 
 * 支持 Photo & Condition Review 格式（买家视角）
 * 同时保持向后兼容旧的 spaceAnalysis 格式
 */
import { Camera, CheckCircle, AlertTriangle, HelpCircle, Search, ChevronRight } from 'lucide-react';

function getSpaceTypeLabel(spaceType: string): string {
  const map: Record<string, string> = {
    kitchen: 'Kitchen',
    bathroom: 'Bathroom',
    bedroom: 'Bedroom',
    living_room: 'Living Room',
    livingroom: 'Living Room',
    exterior: 'Exterior',
    backyard: 'Backyard',
    frontyard: 'Frontyard',
    garage: 'Garage',
    basement: 'Basement',
    pool: 'Pool',
    yard: 'Yard',
    dining_room: 'Dining Room',
    diningroom: 'Dining Room',
    office: 'Office',
    hallway: 'Hallway',
    utility: 'Utility Room',
    stairs: 'Stairs',
    roof: 'Roof',
    laundry: 'Laundry',
    storage: 'Storage',
    unknown: 'Unknown Area',
  };
  return map[spaceType?.toLowerCase()] || spaceType;
}

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-green-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-600';
}

function getScoreBg(score: number): string {
  if (score >= 70) return 'bg-green-50 border-green-200';
  if (score >= 50) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function getConfidenceColor(confidence: string): string {
  switch (confidence?.toLowerCase()) {
    case 'high': return 'text-green-600 bg-green-100';
    case 'medium': return 'text-amber-600 bg-amber-100';
    case 'low': return 'text-red-600 bg-red-100';
    default: return 'text-stone-600 bg-stone-100';
  }
}

// ── New Photo Review Types ──────────────────────────────────────────────────

interface PhotoReviewArea {
  area: string;
  whatLooksLike: string;
  visibleConcerns: string[];
  cannotTellFromPhotos: string[];
  whatToCheckNext: string[];
  confidence: 'High' | 'Medium' | 'Low';
  photoCount?: number;
}

interface PhotoReview {
  moduleTitle: string;
  moduleSubtitle: string;
  overallSummary: string;
  areas: PhotoReviewArea[];
  keyTakeaways: {
    solidSigns: string[];
    needsAttention: string[];
    cannotVerify: string[];
  };
}

// ── Props Interface ─────────────────────────────────────────────────────────

interface PhotoSpaceAnalysisCardProps {
  raw: {
    // New Photo & Condition Review format
    photoReview?: PhotoReview | null;
    // Backward compatible fields
    spaceAnalysis?: Array<{
      spaceType?: string;
      score?: number;
      explanation?: string;
      photoCount?: number;
      observations?: string[];
    }>;
    visualAnalysis?: {
      renovationLevel?: string;
      cosmeticFlipRisk?: string;
      naturalLight?: string;
      spacePerception?: string;
      maintenanceCondition?: string;
      maintenanceImpression?: string;
      kitchenCondition?: string;
      bathroomCondition?: string;
      missingKeyAreas?: string[];
      photoObservations?: string[];
    };
    photos?: Array<{
      photoIndex?: number;
      areaType?: string;
      summary?: string;
      score?: number;
      signals?: string[];
    }>;
    analyzedPhotoCount?: number;
    detectedRooms?: string[];
    roomCounts?: Record<string, number>;
  };
}

// ── Section Components ───────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
        <Camera size={18} className="text-stone-600" strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
        {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function KeyTakeawayBadge({ type, items }: { type: 'solid' | 'attention' | 'verify'; items: string[] }) {
  if (!items || items.length === 0) return null;

  const configs = {
    solid: {
      icon: CheckCircle,
      bg: 'bg-green-50',
      border: 'border-green-200',
      iconColor: 'text-green-600',
      labelColor: 'text-green-700',
      dotColor: 'bg-green-500',
      label: 'Solid Signs'
    },
    attention: {
      icon: AlertTriangle,
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      iconColor: 'text-amber-600',
      labelColor: 'text-amber-700',
      dotColor: 'bg-amber-500',
      label: 'Needs Attention'
    },
    verify: {
      icon: HelpCircle,
      bg: 'bg-stone-50',
      border: 'border-stone-200',
      iconColor: 'text-stone-600',
      labelColor: 'text-stone-700',
      dotColor: 'bg-stone-400',
      label: "Can't Verify"
    }
  };

  const config = configs[type];
  const Icon = config.icon;

  return (
    <div className={`p-3 rounded-xl border ${config.bg} ${config.border}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={config.iconColor} />
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${config.labelColor}`}>
          {config.label}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor} mt-1.5 shrink-0`} />
            <span className="text-xs text-stone-700 leading-snug">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AreaReviewCard({ area }: { area: PhotoReviewArea }) {
  const hasConcerns = area.visibleConcerns && area.visibleConcerns.length > 0;
  const hasCannotVerify = area.cannotTellFromPhotos && area.cannotTellFromPhotos.length > 0;
  const hasNextSteps = area.whatToCheckNext && area.whatToCheckNext.length > 0;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
      {/* Area Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-stone-900">
            {getSpaceTypeLabel(area.area) || area.area}
          </h4>
          {area.photoCount && (
            <span className="text-[10px] text-stone-400">
              ({area.photoCount} photo{area.photoCount !== 1 ? 's' : ''})
            </span>
          )}
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${getConfidenceColor(area.confidence)}`}>
          {area.confidence} confidence
        </span>
      </div>

      {/* What It Looks Like */}
      <div className="mb-3">
        <p className="text-xs text-stone-600 leading-relaxed">
          {area.whatLooksLike}
        </p>
      </div>

      {/* Visible Concerns */}
      {hasConcerns && (
        <div className="mb-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={12} className="text-amber-600" />
            <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
              Visible Concerns
            </span>
          </div>
          <ul className="space-y-1">
            {area.visibleConcerns.map((concern, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="w-1 h-1 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                <span className="text-xs text-amber-800 leading-snug">{concern}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Can't Verify */}
      {hasCannotVerify && (
        <div className="mb-3 p-3 bg-stone-50 rounded-lg border border-stone-200">
          <div className="flex items-center gap-1.5 mb-2">
            <HelpCircle size={12} className="text-stone-500" />
            <span className="text-[10px] font-semibold text-stone-600 uppercase tracking-wider">
              Can't Tell From Photos
            </span>
          </div>
          <ul className="space-y-1">
            {area.cannotTellFromPhotos.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="w-1 h-1 rounded-full bg-stone-400 mt-1.5 shrink-0" />
                <span className="text-xs text-stone-600 leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What to Check Next */}
      {hasNextSteps && (
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
          <div className="flex items-center gap-1.5 mb-2">
            <Search size={12} className="text-blue-600" />
            <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider">
              What to Check Next
            </span>
          </div>
          <ul className="space-y-1">
            {area.whatToCheckNext.map((step, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <ChevronRight size={12} className="text-blue-500 mt-0.5 shrink-0" />
                <span className="text-xs text-blue-800 leading-snug">{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Legacy Space Analysis Card ───────────────────────────────────────────────

function LegacySpaceCard({ space }: { 
  space: { spaceType?: string; score?: number; explanation?: string; photoCount?: number; observations?: string[] }
}) {
  const score = space.score ?? 0;
  
  return (
    <div className={`p-4 rounded-xl border ${getScoreBg(score)}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-600">
          {getSpaceTypeLabel(space.spaceType ?? '')}
        </div>
        <div className={`text-3xl font-semibold leading-none ${getScoreColor(score)}`}>
          {score}
        </div>
      </div>
      {space.photoCount && space.photoCount > 0 && (
        <div className="text-[10px] text-stone-400 mb-2">
          {space.photoCount} photo{space.photoCount !== 1 ? 's' : ''}
        </div>
      )}
      {space.explanation && (
        <div className="text-xs text-stone-500 mb-2 line-clamp-2">{space.explanation}</div>
      )}
      {space.observations && space.observations.length > 0 && (
        <ul className="space-y-1">
          {space.observations.slice(0, 3).map((obs, j) => (
            <li key={j} className="flex items-start gap-1.5 text-xs text-stone-600">
              <span className="text-stone-400 shrink-0 mt-0.5">•</span>
              {obs}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function PhotoSpaceAnalysisCard({ raw }: PhotoSpaceAnalysisCardProps) {
  const { photoReview, spaceAnalysis, visualAnalysis, photos, analyzedPhotoCount, detectedRooms, roomCounts } = raw;

  // Check for new Photo Review format
  const hasPhotoReview = photoReview && 
    (photoReview.areas?.length > 0 || photoReview.overallSummary);

  // Check for legacy formats
  const hasSpaceAnalysis = Array.isArray(spaceAnalysis) && spaceAnalysis.length > 0;
  const hasVisualRead = visualAnalysis && (
    (visualAnalysis.renovationLevel && visualAnalysis.renovationLevel !== 'Unknown') ||
    (visualAnalysis.cosmeticFlipRisk && visualAnalysis.cosmeticFlipRisk !== 'Unknown') ||
    (visualAnalysis.naturalLight && visualAnalysis.naturalLight !== 'Unknown') ||
    (visualAnalysis.spacePerception && visualAnalysis.spacePerception !== 'Unknown') ||
    (visualAnalysis.maintenanceCondition && visualAnalysis.maintenanceCondition !== 'Unknown') ||
    (visualAnalysis.maintenanceImpression && visualAnalysis.maintenanceImpression !== 'Unknown') ||
    (visualAnalysis.kitchenCondition && visualAnalysis.kitchenCondition !== 'Unknown') ||
    (visualAnalysis.bathroomCondition && visualAnalysis.bathroomCondition !== 'Unknown')
  );
  const hasPhotosFallback = Array.isArray(photos) && photos.length > 0;

  if (!hasPhotoReview && !hasSpaceAnalysis && !hasVisualRead && !hasPhotosFallback) {
    return null;
  }

  // ── Render New Photo Review Format ──
  if (hasPhotoReview) {
    const { overallSummary, areas, keyTakeaways } = photoReview!;
    const { solidSigns, needsAttention, cannotVerify } = keyTakeaways || {};

    return (
      <div className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out mb-8">
        {/* Header */}
        <SectionHeader 
          title={photoReview!.moduleTitle || "Photo & Condition Review"} 
          subtitle={photoReview!.moduleSubtitle || "What the photos show, what looks solid, and what still needs checking."}
        />

        {/* Overall Summary */}
        {overallSummary && (
          <div className="mb-5 p-4 bg-stone-50 rounded-xl border border-stone-200">
            <p className="text-sm text-stone-700 leading-relaxed">{overallSummary}</p>
          </div>
        )}

        {/* Key Takeaways Grid */}
        {(solidSigns?.length > 0 || needsAttention?.length > 0 || cannotVerify?.length > 0) && (
          <div className="grid grid-cols-1 @container[size>=600px]:grid-cols-3 gap-3 mb-5">
            <KeyTakeawayBadge type="solid" items={solidSigns || []} />
            <KeyTakeawayBadge type="attention" items={needsAttention || []} />
            <KeyTakeawayBadge type="verify" items={cannotVerify || []} />
          </div>
        )}

        {/* Area Reviews */}
        {areas && areas.length > 0 && (
          <div className="space-y-4">
            {areas.map((area, i) => (
              <AreaReviewCard key={i} area={area} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Render Legacy Format (Backward Compatibility) ──
  const summaryItems: Array<{ label: string; value: string }> = [];
  if (analyzedPhotoCount != null && analyzedPhotoCount > 0) {
    summaryItems.push({ label: 'Photos analysed', value: String(analyzedPhotoCount) });
  }
  if (detectedRooms && detectedRooms.length > 0) {
    const labels = detectedRooms.slice(0, 6).map(r => getSpaceTypeLabel(r));
    summaryItems.push({ label: 'Areas detected', value: labels.join(', ') });
  }
  if (roomCounts && Object.keys(roomCounts).length > 0) {
    const parts = Object.entries(roomCounts)
      .filter(([k]) => k !== 'unknown')
      .slice(0, 4)
      .map(([k, v]) => `${getSpaceTypeLabel(k)} (${v})`);
    if (parts.length > 0) {
      summaryItems.push({ label: 'Photo breakdown', value: parts.join(', ') });
    }
  }

  const visualItems: Array<{ label: string; value: string }> = [];
  if (visualAnalysis) {
    const addIf = (label: string, val?: string) => {
      if (val && val !== 'Unknown' && val.trim()) visualItems.push({ label, value: val });
    };
    addIf('Renovation', visualAnalysis.renovationLevel);
    addIf('Flip Risk', visualAnalysis.cosmeticFlipRisk);
    addIf('Natural Light', visualAnalysis.naturalLight);
    addIf('Space Feel', visualAnalysis.spacePerception);
    addIf('Condition', visualAnalysis.maintenanceCondition ?? visualAnalysis.maintenanceImpression);
    addIf('Kitchen', visualAnalysis.kitchenCondition);
    addIf('Bathroom', visualAnalysis.bathroomCondition);
  }

  const spaceCards = hasSpaceAnalysis ? spaceAnalysis!.map((space) => ({
    spaceType: space.spaceType,
    label: getSpaceTypeLabel(space.spaceType ?? ''),
    score: space.score ?? 0,
    photoCount: space.photoCount ?? 0,
    explanation: space.explanation,
    observations: (space.observations || []).slice(0, 3),
  })) : [];

  const fallbackPhotos = !hasSpaceAnalysis && hasPhotosFallback
    ? photos!.slice(0, 6).map(p => ({
        label: p.areaType ? getSpaceTypeLabel(p.areaType) : 'Photo',
        score: p.score ?? 0,
        summary: p.summary || '',
        signals: (p.signals || []).slice(0, 2),
      }))
    : [];

  return (
    <div className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out mb-8">
      {/* Header */}
      <SectionHeader 
        title="Photo & Space Analysis" 
        subtitle="What the listing photos reveal about condition, layout and liveability"
      />

      {/* A. Summary Row */}
      {summaryItems.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-5 p-3 bg-stone-50 rounded-xl">
          {summaryItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 shrink-0">{item.label}</span>
              <span className="text-xs font-semibold text-stone-800">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* B. Visual Read indicators */}
      {visualItems.length > 0 && (
        <div className="mb-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 mb-3">Visual Read</div>
          <div className="grid grid-cols-2 @container[size>=400px]:grid-cols-3 gap-2">
            {visualItems.map((item, i) => (
              <div key={i} className="flex flex-col p-3 bg-stone-50 rounded-xl">
                <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wider mb-1">{item.label}</span>
                <span className="text-xs font-semibold text-stone-800 leading-snug">{item.value}</span>
              </div>
            ))}
          </div>
          {visualAnalysis?.photoObservations && visualAnalysis.photoObservations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {visualAnalysis.photoObservations.slice(0, 3).map((obs, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-stone-600">
                  <span className="text-stone-400 shrink-0">•</span>
                  {obs}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* C. Space Cards */}
      {spaceCards.length > 0 && (
        <div className="grid grid-cols-1 @container[size>=500px]:grid-cols-2 gap-3">
          {spaceCards.map((card, i) => (
            <LegacySpaceCard key={i} space={card} />
          ))}
        </div>
      )}

      {/* D. Fallback: photo-level summaries */}
      {fallbackPhotos.length > 0 && (
        <div className="grid grid-cols-2 @container[size>=500px]:grid-cols-3 gap-3">
          {fallbackPhotos.map((photo, i) => (
            <div key={i} className={`p-3 rounded-xl border border-stone-100 ${getScoreBg(photo.score)}`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-600">
                  {photo.label}
                </span>
                <span className={`text-2xl font-semibold leading-none ${getScoreColor(photo.score)}`}>
                  {photo.score}
                </span>
              </div>
              {photo.summary && (
                <div className="text-xs text-stone-500 line-clamp-2">{photo.summary}</div>
              )}
              {photo.signals.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {photo.signals.map((s, j) => (
                    <div key={j} className="text-[10px] text-stone-400 truncate">+ {s}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Missing Key Areas */}
      {visualAnalysis?.missingKeyAreas && visualAnalysis.missingKeyAreas.length > 0 && (
        <div className="mt-4 p-3 bg-amber-50 rounded-xl">
          <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-1.5">No Photos Found</div>
          <div className="text-xs text-amber-800">
            {visualAnalysis.missingKeyAreas.join(', ')}
          </div>
        </div>
      )}
    </div>
  );
}
