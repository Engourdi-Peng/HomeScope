/**
 * PhotoSpaceAnalysisCard — shared component
 * "What the Photos Reveal — and What They Don't Show"
 *
 * Part 1: What we can see (existing analysis)
 * Part 2: What is missing (missing photo signals)
 */
import { Camera, Eye, AlertTriangle } from 'lucide-react';

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
    basement: 'Basement / Storage',
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
    storage: 'Basement / Storage',
    basement_storage: 'Basement / Storage',
  };
  const normalized = spaceType?.toLowerCase() ?? '';
  if (map[normalized]) return map[normalized];
  if (/storage|basement|cellar|utility.*room/i.test(normalized)) return 'Basement / Storage';
  return spaceType;
}

const INTERIOR_AREAS = [
  'kitchen', 'bathroom', 'bedroom', 'living room',
  'livingroom', 'hallway', 'dining room', 'basement',
  'storage', 'attic', 'laundry', 'office', 'family room',
];

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

  // ── Part 1: What we can see ────────────────────────────────────────────────

  const summaryItems: Array<{ label: string; value: string }> = [];
  if (analyzedPhotoCount != null && analyzedPhotoCount > 0) {
    summaryItems.push({ label: 'Photos analysed', value: String(analyzedPhotoCount) });
  }
  if (detectedRooms && detectedRooms.length > 0) {
    const labels = detectedRooms.slice(0, 6).map((r) => getSpaceTypeLabel(r));
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

  const spaceCards = hasSpaceAnalysis
    ? spaceAnalysis!.map((space) => ({
        spaceType: space.spaceType,
        label: getSpaceTypeLabel(space.spaceType ?? ''),
        score: space.score ?? 0,
        photoCount: space.photoCount ?? 0,
        explanation: space.explanation,
        observations: (space.observations || []).slice(0, 3),
      }))
    : [];

  const fallbackPhotos =
    !hasSpaceAnalysis && hasPhotosFallback
      ? photos!.slice(0, 6).map((p) => ({
          label: p.areaType ? getSpaceTypeLabel(p.areaType) : 'Photo',
          score: p.score ?? 0,
          summary: p.summary || '',
          signals: (p.signals || []).slice(0, 2),
        }))
      : [];

  // ── Part 2: What is missing ─────────────────────────────────────────────────

  // Determine missing photo signals — PHOTO CONSISTENCY RULE:
  // If interior areas are detected (kitchen/bathroom/bedroom/living room/etc.),
  // do NOT show "Missing Interior Photos" or "No interior photos detected".
  // Only show missing signals when we genuinely lack interior coverage.
  const detectedSet = new Set(
    (detectedRooms ?? []).map((r) => r.toLowerCase())
  );

  // Check if we have any interior photo coverage
  const hasInteriorCoverage = INTERIOR_AREAS.some(area => detectedSet.has(area.toLowerCase()));
  const photoCount = analyzedPhotoCount ?? photos?.length ?? 0;
  const isLimitedPhotos = photoCount <= 3;

  // Only generate missing signals when interior photos are genuinely absent
  const missingSignals: string[] = [];
  if (!hasInteriorCoverage) {
    if (isLimitedPhotos) {
      if (!detectedSet.has('kitchen') && !detectedSet.has('bathroom') && !detectedSet.has('bedroom')) {
        missingSignals.push('No interior photos detected');
      }
      if (!detectedSet.has('kitchen')) missingSignals.push('No kitchen condition shown');
      if (!detectedSet.has('bathroom')) missingSignals.push('No bathroom condition shown');
      if (!detectedSet.has('basement')) missingSignals.push('No basement or foundation clues');
      if (!detectedSet.has('roof')) missingSignals.push('No roof close-up');
      if (!detectedSet.has('garage')) missingSignals.push('No garage or parking area shown');
      if (!detectedSet.has('exterior')) missingSignals.push('No exterior close-up');
    }
    // From visualAnalysis missingKeyAreas
    if (visualAnalysis?.missingKeyAreas && visualAnalysis.missingKeyAreas.length > 0) {
      for (const area of visualAnalysis.missingKeyAreas) {
        const normalized = area.toLowerCase();
        const mapped = `No ${getSpaceTypeLabel(normalized).toLowerCase()} detected`;
        if (!missingSignals.includes(mapped)) missingSignals.push(mapped);
      }
    }
  }

  const hasMissingSignals = missingSignals.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 sm:mb-6">
        <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <Camera size={18} className="text-stone-600" strokeWidth={1.5} />
        </div>
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">
            What the Photos Reveal — and What They Don&apos;t Show
          </h3>
        </div>
      </div>

      {/* ── Part 1: What we can see ── */}

      {/* Summary Row */}
      {summaryItems.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-5 p-3 bg-stone-50 rounded-xl">
          {summaryItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 shrink-0">
                {item.label}
              </span>
              <span className="text-xs font-semibold text-stone-800">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Visual Read indicators */}
      {visualItems.length > 0 && (
        <div className="mb-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 mb-3">
            Visual Read
          </div>
          <div className="grid grid-cols-2 @container[size>=400px]:grid-cols-3 gap-2">
            {visualItems.map((item, i) => (
              <div key={i} className="flex flex-col p-3 bg-stone-50 rounded-xl">
                <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wider mb-1">
                  {item.label}
                </span>
                <span className="text-xs font-semibold text-stone-800 leading-snug">{item.value}</span>
              </div>
            ))}
          </div>
          {visualAnalysis?.photoObservations && visualAnalysis.photoObservations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {visualAnalysis.photoObservations.slice(0, 3).map((obs, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-stone-600">
                  <span className="text-stone-400 shrink-0">-</span>
                  {obs}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Space Cards */}
      {spaceCards.length > 0 && (
        <div className="grid grid-cols-1 @container[size>=500px]:grid-cols-2 gap-3 mb-5">
          {spaceCards.map((card, i) => (
            <div
              key={i}
              className={`p-4 rounded-xl border border-stone-100 ${getScoreBg(card.score)}`}
            >
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
                      <span className="text-stone-400 shrink-0 mt-0.5">-</span>
                      {obs}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fallback: photo-level summaries */}
      {fallbackPhotos.length > 0 && (
        <div className="grid grid-cols-2 @container[size>=500px]:grid-cols-3 gap-3 mb-5">
          {fallbackPhotos.map((photo, i) => (
            <div
              key={i}
              className={`p-3 rounded-xl border border-stone-100 ${getScoreBg(photo.score)}`}
            >
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

      {/* ── Part 2: What is missing ── */}

      {hasMissingSignals && (
        <div className="mt-4 pt-5 border-t border-stone-200">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              What the Photos Don&apos;t Show
            </span>
          </div>

          {/* Limited photos warning — only show when no interior photos detected */}
          {isLimitedPhotos && !hasInteriorCoverage && photoCount <= 2 && (
            <div className="rounded-xl p-4 mb-4 bg-amber-50 border border-amber-200">
              <p className="text-amber-800 text-sm leading-relaxed">
                Only exterior photos were available. No kitchen, bathroom, bedroom, basement, roof, or
                mechanical-system photos were detected. This limits confidence and should be treated as a
                viewing risk.
              </p>
            </div>
          )}

          {/* Missing signals list */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {missingSignals.map((signal, i) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="w-5 h-5 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                </div>
                <span className="text-slate-700 text-xs leading-relaxed">{signal}</span>
              </div>
            ))}
          </div>

          {/* Why this matters */}
          <div className="rounded-xl p-4 bg-slate-50 border border-slate-200">
            <div className="flex items-start gap-2">
              <Eye className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <p className="text-slate-600 text-sm leading-relaxed">
                Missing photos do not prove there is a problem, but they reduce confidence. Ask for
                additional photos before spending time on a viewing.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Good coverage note */}
      {!hasMissingSignals && (
        <div className="mt-4 pt-5 border-t border-stone-200">
          <div className="rounded-xl p-4 bg-emerald-50 border border-emerald-100">
            <div className="flex items-start gap-2">
              <Camera className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <p className="text-emerald-700 text-sm leading-relaxed">
                Photo coverage looks reasonable, but still verify condition in person.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
