/**
 * PhotoSpaceAnalysisCard — 共享组件
 * 被 NewReportUI (网站主链路) 和 USSaleReport (extension 备用链路) 共用。
 */
import { Camera } from 'lucide-react';

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
    unknown: 'Unknown Area',
  };
  return map[spaceType?.toLowerCase()] || spaceType;
}

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-green-500';
  if (score >= 50) return 'text-amber-500';
  return 'text-red-500';
}

function getScoreBg(score: number): string {
  if (score >= 70) return 'bg-green-50';
  if (score >= 50) return 'bg-amber-50';
  return 'bg-red-50';
}

interface PhotoSpaceAnalysisCardProps {
  raw: {
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

export function PhotoSpaceAnalysisCard({ raw }: PhotoSpaceAnalysisCardProps) {
  const spaceAnalysis = raw?.spaceAnalysis;
  const visualAnalysis = raw?.visualAnalysis;
  const photos = raw?.photos;
  const analyzedPhotoCount = raw?.analyzedPhotoCount;
  const detectedRooms = raw?.detectedRooms;
  const roomCounts = raw?.roomCounts;

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

  if (!hasSpaceAnalysis && !hasVisualRead && !hasPhotosFallback) {
    return null;
  }

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
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <Camera size={18} className="text-stone-600" strokeWidth={1.5} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Photo &amp; Space Analysis</h3>
          <p className="text-xs text-stone-500">What the listing photos reveal about condition, layout and liveability</p>
        </div>
      </div>

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
            <div key={i} className={`p-4 rounded-xl border border-stone-100 ${getScoreBg(card.score)}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-600">
                  {card.label}
                </div>
                <div className={`text-3xl font-semibold leading-none ${getScoreColor(card.score)}`}>
                  {card.score}
                </div>
              </div>
              {card.photoCount > 0 && (
                <div className="text-[10px] text-stone-400 mb-2">
                  {card.photoCount} photo{card.photoCount !== 1 ? 's' : ''}
                </div>
              )}
              {card.explanation && (
                <div className="text-xs text-stone-500 mb-2 line-clamp-2">{card.explanation}</div>
              )}
              {card.observations.length > 0 && (
                <ul className="space-y-1">
                  {card.observations.map((obs, j) => (
                    <li key={j} className="flex items-start gap-1.5 text-xs text-stone-600">
                      <span className="text-stone-400 shrink-0 mt-0.5">•</span>
                      {obs}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
