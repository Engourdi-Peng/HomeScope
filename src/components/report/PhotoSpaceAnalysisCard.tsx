/**
 * PhotoSpaceAnalysisCard — shared component
 * "Visual Risks & What Photos Don't Prove"
 *
 * 3-tier display:
 * Tier 1 (always visible): Top Visual Concerns + What Photos Do Not Verify
 * Tier 2 (collapsible): Room-by-Room Breakdown
 *
 * Supports both new risk-focused format (areas[].visualConcerns, areas[].inspectionQuestions, etc.)
 * and legacy format (spaceAnalysis[], concerns[], missingViews[]).
 */
import { Camera, Eye, AlertTriangle, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

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
    garage: 'Garage / Driveway',
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
    laundry: 'Laundry / Mechanical',
  };
  const normalized = spaceType?.toLowerCase() ?? '';
  if (map[normalized]) return map[normalized];
  if (/storage|basement|cellar/i.test(normalized)) return 'Basement / Storage';
  if (/laundry|mechanical|utility/i.test(normalized)) return 'Laundry / Mechanical';
  return spaceType;
}

const INTERIOR_AREAS = [
  'kitchen', 'bathroom', 'bedroom', 'living room',
  'livingroom', 'hallway', 'dining room', 'basement',
  'storage', 'attic', 'laundry', 'office', 'family room',
];

const WATCHOUT_INDICATOR_PATTERN = /not shown|not visible|unclear|verify|exposed|moisture|crack|damage|damaged|dated|worn|small|cramped|low ceiling|limited|missing|unknown|older|water|foundation|electrical|plumbing|roof|boiler|hvac|egress|permit|code|legal|age is not verifiable|cannot be fully assessed|history cannot be confirmed/i;
const MISSING_VIEW_PATTERN = /not shown|not visible|missing|unclear|verify|under-sink|close-up|close up|ventilation|range hood|outlets|electrical panel|foundation walls|basement corners|boiler|water heater|sump pump|floor drain|caulk|grout/i;
const STRENGTH_PATTERN = /well-maintained|well maintained|good natural light|bright|updated|renovated|functional|clean|appears maintained|stainless|hardwood|usable|spacious|open/i;

function getConfidenceColor(confidence: string): string {
  if (confidence === 'High') return 'text-stone-600 bg-stone-100';
  if (confidence === 'Medium') return 'text-amber-700 bg-amber-50';
  if (confidence === 'Low') return 'text-orange-700 bg-orange-50';
  return 'text-stone-500 bg-stone-50';
}

function getCoverageLabel(confidence: string): string {
  if (confidence === 'High') return 'Good';
  if (confidence === 'Medium') return 'Partial';
  if (confidence === 'Low') return 'Limited';
  return 'Partial';
}

function cleanLine(value: string): string {
  return value.replace(/^[-•!\s]+/, '').trim();
}

function uniqueLines(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanLine(String(value ?? ''));
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function isWatchoutLike(text: string): boolean {
  return WATCHOUT_INDICATOR_PATTERN.test(text);
}

function isMissingViewLike(text: string): boolean {
  return MISSING_VIEW_PATTERN.test(text);
}

function isStrengthLike(text: string): boolean {
  return STRENGTH_PATTERN.test(text);
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface PhotoArea {
  area?: string;
  spaceType?: string;
  conditionScore?: number;
  score?: number;
  photoCount?: number;
  confidence?: string;
  visualConcerns?: string[];
  concerns?: string[];
  strengths?: string[];
  missingEvidence?: string[];
  missingViews?: string[];
  inspectionQuestions?: string[];
  buyerTakeaway?: string;
  explanation?: string;
  observations?: string[];
}

interface StagingSignals {
  hasVirtualStaging?: boolean;
  notes?: string[];
}

interface ModernPhotoPayload {
  overallTakeaway?: string;
  keyConcerns?: string[];
  missingViews?: string[];
  areas?: PhotoArea[];
  inspectionPriorities?: string[];
  totalPhotosAnalyzed?: number;
  hasVirtualStaging?: boolean;
}

interface PhotoSpaceAnalysisCardProps {
  raw: {
    areas?: PhotoArea[];
    topVisibleConcerns?: string[];
    topVisualConcerns?: string[];
    importantMissingViews?: string[];
    inspectionPrioritiesFromPhotos?: string[];
    stagingSignals?: StagingSignals;
    photo_analysis?: ModernPhotoPayload;
    photoAnalysis?: ModernPhotoPayload;
    totalPhotos?: number;
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

interface SpaceCardVM {
  label: string;
  photoCount: number;
  confidence: string;
  observed: string[];
  strengths: string[];
  watchouts: string[];
  missingViews: string[];
  buyerTakeaway: string;
  explanation: string;
}

function normalizeLegacyAreas(
  spaceAnalysis: PhotoSpaceAnalysisCardProps['raw']['spaceAnalysis'],
): PhotoArea[] {
  if (!Array.isArray(spaceAnalysis) || spaceAnalysis.length === 0) return [];
  return spaceAnalysis.map((s) => ({
    area: s.spaceType,
    spaceType: s.spaceType,
    conditionScore: s.score,
    score: s.score,
    photoCount: s.photoCount,
    confidence: 'Medium',
    visualConcerns: [],
    strengths: [],
    missingEvidence: [],
    inspectionQuestions: [],
    buyerTakeaway: s.explanation ?? '',
    explanation: s.explanation,
    observations: s.observations,
  }));
}

function splitAreaContent(area: PhotoArea, isLegacy: boolean): SpaceCardVM {
  const observed: string[] = [];
  const strengths: string[] = [];
  const watchouts: string[] = [];
  const missingViews: string[] = [];

  const sourceObserved = uniqueLines(area.observations ?? []);
  const sourceStrengths = uniqueLines(area.strengths ?? []);
  const sourceConcerns = uniqueLines([...(area.visualConcerns ?? []), ...(area.concerns ?? [])]);
  const sourceMissing = uniqueLines([...(area.missingEvidence ?? []), ...(area.missingViews ?? [])]);

  sourceObserved.forEach((line) => {
    if (isStrengthLike(line)) strengths.push(line);
    else observed.push(line);
  });

  sourceStrengths.forEach((line) => {
    if (isWatchoutLike(line) && !isStrengthLike(line)) watchouts.push(line);
    else strengths.push(line);
  });

  sourceConcerns.forEach((line) => {
    if (isLegacy) {
      if (isMissingViewLike(line)) missingViews.push(line);
      else if (isWatchoutLike(line)) watchouts.push(line);
      else if (isStrengthLike(line)) strengths.push(line);
      else observed.push(line);
      return;
    }

    if (isMissingViewLike(line)) missingViews.push(line);
    else if (isWatchoutLike(line)) watchouts.push(line);
    else if (isStrengthLike(line)) strengths.push(line);
    else observed.push(line);
  });

  sourceMissing.forEach((line) => {
    if (isMissingViewLike(line)) missingViews.push(line);
    else if (isWatchoutLike(line)) watchouts.push(line);
    else observed.push(line);
  });

  return {
    label: getSpaceTypeLabel(area.area ?? area.spaceType ?? ''),
    photoCount: area.photoCount ?? 0,
    confidence: area.confidence ?? 'Medium',
    observed: uniqueLines(observed).slice(0, 3),
    strengths: uniqueLines(strengths).slice(0, 3),
    watchouts: uniqueLines(watchouts).slice(0, 3),
    missingViews: uniqueLines(missingViews).slice(0, 4),
    buyerTakeaway: cleanLine(area.buyerTakeaway ?? ''),
    explanation: cleanLine(area.explanation ?? ''),
  };
}

export function PhotoSpaceAnalysisCard({ raw }: PhotoSpaceAnalysisCardProps) {
  const [areaExpanded, setAreaExpanded] = useState(false);

  const modernPhoto = raw?.photo_analysis ?? raw?.photoAnalysis ?? null;
  const modernAreas = Array.isArray(modernPhoto?.areas) ? modernPhoto.areas : [];
  const modernTopConcerns = uniqueLines(raw?.topVisibleConcerns ?? raw?.topVisualConcerns ?? modernPhoto?.keyConcerns ?? []);
  const modernMissingViews = uniqueLines(raw?.importantMissingViews ?? modernPhoto?.missingViews ?? []);
  const modernInspectionPriorities = uniqueLines(raw?.inspectionPrioritiesFromPhotos ?? modernPhoto?.inspectionPriorities ?? []);
  const totalPhotosAnalyzed = raw?.totalPhotos ?? modernPhoto?.totalPhotosAnalyzed ?? raw?.analyzedPhotoCount ?? 0;
  const overallTakeaway = cleanLine(modernPhoto?.overallTakeaway ?? '');
  const stagingSignals = raw?.stagingSignals ?? {
    hasVirtualStaging: modernPhoto?.hasVirtualStaging,
    notes: [],
  };

  const hasModernPhotoData = modernAreas.length > 0
    || modernTopConcerns.length > 0
    || modernMissingViews.length > 0
    || modernInspectionPriorities.length > 0
    || !!overallTakeaway;

  const legacyAreas = normalizeLegacyAreas(raw?.spaceAnalysis);
  const detectedRooms = raw?.detectedRooms ?? [];
  const legacyPhotoCount = raw?.analyzedPhotoCount ?? raw?.photos?.length ?? 0;
  const isLegacyFallback = !hasModernPhotoData;

  const areas = hasModernPhotoData ? modernAreas : legacyAreas;
  const concerns = hasModernPhotoData ? modernTopConcerns : [];
  const inspPriorities = hasModernPhotoData ? modernInspectionPriorities : [];
  const photoCount = totalPhotosAnalyzed || legacyPhotoCount;

  const hasStaging = stagingSignals?.hasVirtualStaging === true;
  const flipRisk = raw?.visualAnalysis?.cosmeticFlipRisk;
  const legacyHasStaging = flipRisk === 'High' || flipRisk === 'Medium';

  const legacyMissingSignals: string[] = [];
  if (isLegacyFallback) {
    const detectedSet = new Set(detectedRooms.map(r => r.toLowerCase()));
    const hasInteriorCoverage = INTERIOR_AREAS.some(a => detectedSet.has(a.toLowerCase()));
    if (!hasInteriorCoverage) {
      if (!detectedSet.has('kitchen')) legacyMissingSignals.push('Kitchen condition not shown');
      if (!detectedSet.has('bathroom')) legacyMissingSignals.push('Bathroom condition not shown');
      if (!detectedSet.has('basement')) legacyMissingSignals.push('Basement and foundation not shown');
      if (!detectedSet.has('roof')) legacyMissingSignals.push('Roof close-up not available');
      if (!detectedSet.has('garage')) legacyMissingSignals.push('Garage or parking area not shown');
    }
    if (raw?.visualAnalysis?.missingKeyAreas?.length) {
      for (const area of raw.visualAnalysis.missingKeyAreas) {
        const mapped = `${getSpaceTypeLabel(area)} not detected`;
        if (!legacyMissingSignals.includes(mapped)) legacyMissingSignals.push(mapped);
      }
    }
  }

  const effectiveMissingViews = hasModernPhotoData ? modernMissingViews : uniqueLines(legacyMissingSignals);
  const hasMissingSignals = effectiveMissingViews.length > 0;
  const showStagingWarning = hasStaging || legacyHasStaging;

  const spaceCards = useMemo(() => areas.map((area) => splitAreaContent(area, isLegacyFallback)), [areas, isLegacyFallback]);

  if (areas.length === 0 && concerns.length === 0 && effectiveMissingViews.length === 0) {
    return null;
  }

  const areaPhotoTotal = areas.reduce((sum, a) => sum + (a.photoCount ?? 0), 0);
  const unclassifiedPhotoCount = photoCount > areaPhotoTotal ? photoCount - areaPhotoTotal : 0;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <Camera size={18} className="text-stone-600" strokeWidth={1.5} />
        </div>
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">
            Visual Risks &amp; What Photos Don&apos;t Prove
          </h3>
          {photoCount > 0 && (
            <p className="text-xs text-stone-500 mt-0.5">
              {photoCount} photo{photoCount !== 1 ? 's' : ''} analysed
              {hasModernPhotoData && areas.length > 0 && ` · ${areas.length} area${areas.length !== 1 ? 's' : ''} detected`}
              {unclassifiedPhotoCount > 0 && (
                <span className="text-stone-400">
                  {' '}· {unclassifiedPhotoCount} additional photo{unclassifiedPhotoCount !== 1 ? 's' : ''} reviewed but not individually displayed
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mb-5 p-3 bg-stone-50 rounded-xl border border-stone-100">
        <p className="text-xs text-stone-600 leading-relaxed">
          Photos can help spot visible issues, but they cannot confirm permits, system age, roof life, moisture history, or code compliance.
        </p>
      </div>

      {hasModernPhotoData && overallTakeaway && (
        <div className="mb-5 p-3 bg-stone-50 rounded-xl border border-stone-100">
          <p className="text-xs text-stone-700 leading-relaxed">{overallTakeaway}</p>
        </div>
      )}

      {hasModernPhotoData && concerns.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-amber-600 shrink-0" />
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
              Top Visual Concerns
            </span>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
            <ul className="space-y-1.5">
              {concerns.slice(0, 3).map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-800 leading-relaxed">
                  <span className="text-amber-500 shrink-0 mt-0.5 font-bold">!</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {hasMissingSignals && (
        <div className="mb-5 pt-5 border-t border-stone-200">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-stone-500 shrink-0" />
            <span className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              What Photos Do Not Verify
            </span>
          </div>

          {showStagingWarning && (
            <div className="rounded-xl p-3 mb-3 bg-violet-50 border border-violet-100 flex items-start gap-2">
              <AlertTriangle size={13} className="text-violet-600 shrink-0 mt-0.5" />
              <p className="text-xs text-violet-800 leading-relaxed">
                Some photos may show virtual staging or digitally added furniture. Verify actual property condition in person before offering.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            {effectiveMissingViews.slice(0, 6).map((view, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="w-5 h-5 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center shrink-0">
                  <Camera size={10} className="text-stone-400" />
                </div>
                <span className="text-xs text-slate-700 leading-relaxed">{view}</span>
              </div>
            ))}
          </div>

          {inspPriorities.length > 0 && (
            <div className="rounded-xl p-3 bg-stone-50 border border-stone-200">
              <div className="flex items-center gap-1.5 mb-2">
                <HelpCircle size={11} className="text-stone-400 shrink-0" />
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">
                  View in Person
                </p>
              </div>
              <ul className="space-y-1">
                {inspPriorities.slice(0, 4).map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-stone-700 leading-relaxed">
                    <span className="text-stone-400 shrink-0 mt-0.5">-</span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!inspPriorities.length && (
            <div className="rounded-xl p-3 bg-stone-50 border border-stone-200">
              <div className="flex items-start gap-2">
                <Eye className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                <p className="text-xs text-stone-600 leading-relaxed">
                  Missing photos do not confirm a problem exists, but they reduce confidence. Ask for additional photos before spending time on a viewing.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {spaceCards.length > 0 && (
        <div className="pt-5 border-t border-stone-200">
          <button
            type="button"
            className="w-full flex items-center justify-between mb-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 rounded-lg p-1 -mx-1"
            onClick={() => setAreaExpanded(prev => !prev)}
          >
            <span className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              {areaExpanded ? 'Hide' : 'Show'} Room-by-Room Breakdown
            </span>
            {areaExpanded ? (
              <ChevronUp size={16} className="text-stone-500" />
            ) : (
              <ChevronDown size={16} className="text-stone-500" />
            )}
          </button>

          {areaExpanded && (
            <div className="grid grid-cols-1 @container[size>=500px]:grid-cols-2 gap-3">
              {spaceCards.map((card, i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl border border-stone-200 bg-stone-50/50"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-700">
                      {card.label}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {card.confidence !== 'Medium' && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${getConfidenceColor(card.confidence)}`}>
                          {card.confidence}
                        </span>
                      )}
                      <span className="text-[10px] text-stone-400">
                        Coverage: {getCoverageLabel(card.confidence)}
                      </span>
                    </div>
                  </div>

                  {card.photoCount > 0 && (
                    <div className="text-[10px] text-stone-400 mb-2">
                      {card.photoCount} photo{card.photoCount !== 1 ? 's' : ''}
                    </div>
                  )}

                  {card.observed.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1">Observed Issues</div>
                      <div className="space-y-1">
                        {card.observed.map((item, idx) => (
                          <div key={idx} className="flex items-start gap-1 text-xs text-stone-700 leading-relaxed">
                            <span className="text-stone-300 shrink-0">-</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {card.watchouts.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1 mb-0.5">
                        <AlertTriangle size={10} className="text-amber-500 shrink-0" />
                        <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-widest">Possible Risks</span>
                      </div>
                      {card.watchouts.map((c, j) => (
                        <div key={j} className="flex items-start gap-1 text-xs text-stone-700 leading-relaxed">
                          <span className="text-amber-400 shrink-0 font-bold">!</span>
                          <span>{c}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {card.missingViews.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Camera size={10} className="text-stone-400 shrink-0" />
                        <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Missing / Not Visible</span>
                      </div>
                      {card.missingViews.map((v, j) => (
                        <div key={j} className="flex items-start gap-1 text-xs text-stone-600 leading-relaxed">
                          <span className="text-stone-300 shrink-0">-</span>
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {card.buyerTakeaway && (
                    <div className="pt-2 border-t border-stone-200">
                      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1">Verify Before Viewing</div>
                      <p className="text-xs text-stone-700 leading-relaxed">{card.buyerTakeaway}</p>
                    </div>
                  )}

                  {!card.buyerTakeaway && card.explanation && (
                    <div className="pt-2 border-t border-stone-200">
                      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1">Verify Before Viewing</div>
                      <p className="text-xs text-stone-600 leading-relaxed">{card.explanation}</p>
                    </div>
                  )}

                  {card.observed.length === 0 && card.watchouts.length === 0 && card.missingViews.length === 0 && !card.buyerTakeaway && !card.explanation && (
                    <div className="mb-1.5 p-2 rounded-lg bg-stone-100 border border-stone-200">
                      <p className="text-[11px] text-stone-500 leading-relaxed">
                        No clear visual defect is confirmed from photos, but this area still needs in-person inspection. Photos cannot verify hidden damage, system age, permits, moisture history, or code compliance.
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
