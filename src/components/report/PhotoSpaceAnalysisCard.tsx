/**
 * PhotoSpaceAnalysisCard — 共享组件
 * 被 NewReportUI (网站主链路) 和 USSaleReport (extension 备用链路) 共用。
 *
 * 支持 Photo & Condition Review 格式（买家视角）
 * 同时保持向后兼容旧的 spaceAnalysis 格式
 *
 * v2 (Presentation Layer only): 重新组织为
 *   Observation → Meaning → Confidence → Action
 * 不动数据、adapter、prompt、business logic。
 */
import { Camera, AlertTriangle, Search } from 'lucide-react';
import {
  mergePhotoReviewAreas,
  type PhotoReviewAreaRecord,
} from '../../lib/reportAdapters/photoReviewAreas';

// ── Buyer-flavored phrase filter ────────────────────────────────────────────
// Filters sale-specific actor/process phrases that leak through from the Step 1
// Zillow-structured output (originally written for US Sale reports).  In rent
// reports these phrases appear in photo analysis text (e.g. "Ask the listing
// agent", "property being sold") and must be replaced with renter-accurate
// language or the whole item dropped.
const BUYER_FLAVORED_PATTERNS: RegExp[] = [
  /\bproperty\s+being\s+(sold|purchased)\b/i,
  /\blisting\s+agent\b/i,
  /\bseller'?s?\s+(agent|representation)\b/i,
  /\b(buyer'?s?|seller'?s?)\s+agent\b/i,
  /\bfinancing\s+or\s+insurance\b/i,
  /\bseller\s+disclosure\b/i,
  /\brenovation\s+permit(s|history)?\b/i,
  /\bproperty\s+sale\b/i,
  /\bclose\s+of\s+escrow\b/i,
  /\binspection\s+contingency\b/i,
  /\bbuy\s+the\s+property\b/i,
  /\bmake\s+an?\s+offer\b/i,
  /\bbuyer'?s?\s+market\b/i,
];

/**
 * Returns a renter-safe version of `text` by replacing known buyer-flavored
 * actor/process phrases. Drops the entire string if it consists only of those
 * phrases (length < 15 after stripping). Used for `whatLooksLike` and
 * `whatToCheckNext` fields where the core information should be preserved but
 * the actor references need to be neutralised.
 *
 * When `isRent` is false (sale reports), returns the text UNCHANGED so that
 * "Ask the listing agent" stays as-is in sale context. The rent-flavored
 * replacements are only applied for rent reports.
 */
function rentSafeText(text: string | undefined | null, isRent = true): string {
  if (!text) return '';
  let result = text;
  // Only apply rent-flavored replacements for rent reports
  if (isRent) {
    result = result
      .replace(/\blisting\s+agent\b/gi, 'property manager or landlord')
      .replace(/\bseller'?s?\s+(agent|representation)\b/gi, 'property manager or landlord')
      .replace(/\b(buyer'?s?|seller'?s?)\s+agent\b/gi, 'property contact')
      .replace(/\bproperty\s+being\s+(sold|purchased)\b/gi, 'rental listing')
      .replace(/\brenovation\s+permit(s|history)?\b/gi, 'disclosure documents')
      .replace(/\bseller\s+disclosure\b/gi, 'landlord disclosure')
      .replace(/\bproperty\s+sale\b/gi, 'rental listing')
      .replace(/\bfinancing\s+or\s+insurance\b/gi, 'insurance or lease terms')
      .replace(/\bbuy\s+the\s+property\b/gi, 'apply for the rental')
      .replace(/\bmake\s+an?\s+offer\b/gi, 'submit a rental application');
    // Drop if the item is now empty or consists only of neutralised phrases
    if (result.trim().length < 10) return '';
  }
  return result;
}

/**
 * Returns true if `text` contains a buyer-flavored phrase that cannot be
 * meaningfully neutralised (e.g. "close of escrow", "inspection contingency").
 * Used to drop entire `cannotVerify` / `visibleConcerns` items.
 */
function hasBuyerFlavor(text: string | undefined | null): boolean {
  if (!text) return false;
  return BUYER_FLAVORED_PATTERNS.some((re) => re.test(text));
}

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
    dining: 'Dining',
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

/**
 * Severity classification for concerns & watch items.
 * Uses ONLY left-border colour cues — never full coloured background blocks.
 */
type Severity = 'concern' | 'watch' | 'informational' | 'positive';

function classifySeverity(text: string): Severity {
  const t = text.toLowerCase();
  // Strong concern keywords → concern
  if (
    /\b(mold|mould|rot|water damage|active leak|severe|cracked|failing|failed|hazard|unsafe)\b/.test(
      t
    )
  ) {
    return 'concern';
  }
  // Watch keywords
  if (
    /\b(wear|older|dated|discoloration|sealant|caulk|aging|unclear|possible|potential|may|might|could indicate|verify|inspect)\b/.test(
      t
    )
  ) {
    return 'watch';
  }
  return 'informational';
}

function severityBorderClass(severity: Severity): string {
  switch (severity) {
    case 'concern':
      return 'border-l-amber-700';
    case 'watch':
      return 'border-l-amber-800';
    case 'positive':
      return 'border-l-stone-400';
    case 'informational':
    default:
      return 'border-l-stone-500';
  }
}

function severityLabel(severity: Severity): string {
  switch (severity) {
    case 'concern':
      return 'Concern';
    case 'watch':
      return 'Watch';
    case 'positive':
      return 'Positive';
    case 'informational':
    default:
      return 'Note';
  }
}

// ── New Photo Review Types ──────────────────────────────────────────────────

interface PhotoReviewArea extends PhotoReviewAreaRecord {
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
    // reportMode: used to determine whether rent-flavored text replacements apply
    reportMode?: string;
    // Backward compatible fields
    spaceAnalysis?: Array<{
      spaceType?: string;
      score?: number;
      explanation?: string;
      photoCount?: number;
      observations?: string[];
    }>;
    visualAnalysis?: {
      photoReview?: PhotoReview | null;
      spaceAnalysis?: Array<{
        spaceType?: string;
        score?: number;
        explanation?: string;
        photoCount?: number;
        observations?: string[];
      }>;
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
      imageUrl?: string;
      url?: string;
    }>;
    analyzedPhotoCount?: number;
    detectedRooms?: string[];
    roomCounts?: Record<string, number>;
  };
}

// ── Helper: find a small set of photo URLs to attach as evidence to a finding.
// We don't have explicit finding→photo wiring in the schema, so we use a simple
// heuristic: prefer photos whose areaType matches the area label; fall back to
// the first N photos overall. Returns empty array when no usable URLs are present.
function pickEvidencePhotos(
  area: PhotoReviewArea | null,
  rawPhotos: PhotoSpaceAnalysisCardProps['raw']['photos'],
  max = 3
): Array<{ url: string; label: string }> {
  if (!rawPhotos || rawPhotos.length === 0) return [];
  const targetArea = (area?.area ?? '').toLowerCase();

  const withUrl = rawPhotos
    .map((p, idx) => ({
      idx,
      url: p.imageUrl || p.url || '',
      areaType: (p.areaType ?? '').toLowerCase(),
      summary: p.summary ?? '',
    }))
    .filter((p) => Boolean(p.url));

  if (withUrl.length === 0) return [];

  let pool = withUrl;
  if (targetArea && targetArea !== 'unknown') {
    const matched = withUrl.filter((p) =>
      p.areaType && p.areaType.includes(targetArea)
    );
    if (matched.length > 0) pool = matched;
  }

  return pool.slice(0, max).map((p) => ({
    url: p.url,
    label: p.summary || (p.areaType ? getSpaceTypeLabel(p.areaType) : `Photo ${p.idx + 1}`),
  }));
}

// ── Section Components ───────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-4 mb-6">
      <div className="w-11 h-11 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0">
        <Camera size={18} className="text-teal-600" strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <h2 className="report-display-2 text-stone-900">{title}</h2>
        {subtitle && <p className="report-module-explainer mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

/**
 * Overall Visual Summary — editorial callout with a teal accent.
 * No background fill; reads as the lead paragraph of the section.
 */
function OverallSummaryCallout({ summary }: { summary: string }) {
  if (!summary) return null;
  return (
    <div className="mb-7 pl-4 border-l-4 border-teal-500">
      <div className="report-sublabel mb-1.5 text-teal-700">Overall Summary</div>
      <p className="report-lead-2">{summary}</p>
    </div>
  );
}

/**
 * Inline dot list — used for Positive Signals / What Photos Cannot Confirm /
 * Next Inspection Focus. No card, no background, no shadow.
 */
function InlineList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-2 w-1 h-1 rounded-full bg-stone-400 shrink-0"
          />
          <span className="report-finding-body">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Sub-section header (within the module): small uppercase label + H3 title.
 */
function SubSectionHeading({
  eyebrow,
  title,
  hint,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-5">
      <div className="report-sublabel mb-1 text-teal-700">{eyebrow}</div>
      <h3 className="report-h3">{title}</h3>
      {hint && <p className="report-module-explainer mt-1.5 text-stone-600">{hint}</p>}
    </div>
  );
}

/**
 * Confidence pill — neutral stone scale. No red/amber/green to avoid implying
 * an emotional risk reading on confidence.
 */
function ConfidencePill({ confidence }: { confidence: PhotoReviewArea['confidence'] }) {
  const tone: Record<PhotoReviewArea['confidence'], string> = {
    High: 'bg-stone-900 text-white',
    Medium: 'bg-stone-200 text-stone-800',
    Low: 'bg-stone-100 text-stone-600',
  };
  const safe = (confidence in tone ? confidence : 'Medium') as keyof typeof tone;
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full tabular-nums ${tone[safe]}`}
    >
      {safe} confidence
    </span>
  );
}

/**
 * Finding row — flat sub-surface with new styling.
 * Evidence thumbnail row is optional and only rendered when we have matching photos.
 */
function FindingRow({
  area,
  evidencePhotos,
  isRent,
}: {
  area: PhotoReviewArea;
  evidencePhotos: Array<{ url: string; label: string }>;
  isRent: boolean;
}) {
  const cleanWhatLooksLike = rentSafeText(area.whatLooksLike, isRent);
  if (!cleanWhatLooksLike) return null;

  const areaLabel = getSpaceTypeLabel(area.area) || area.area;
  const photoCount = area.photoCount ?? 0;

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-5 md:p-6 report-elevated">
      {/* Title row */}
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h4 className="report-finding-title">{areaLabel}</h4>
          {photoCount > 0 && (
            <div className="report-meta mt-0.5">
              {photoCount} photo{photoCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
        <div className="shrink-0">
          <ConfidencePill confidence={area.confidence} />
        </div>
      </header>

      {/* Observation (the finding body) */}
      <p className="report-finding-body">{cleanWhatLooksLike}</p>

      {/* Evidence thumbnails */}
      {evidencePhotos.length > 0 && (
        <div
          className="
            mt-5 -mx-1 px-1
            flex gap-2 overflow-x-auto
            snap-x snap-mandatory
            md:overflow-visible md:snap-none
          "
          aria-label="Photo evidence"
        >
          {evidencePhotos.map((p, i) => (
            <figure
              key={i}
              className="
                shrink-0 snap-start
                w-[160px]
                md:w-auto md:shrink md:flex-1 md:max-w-[200px]
              "
            >
              <div className="relative w-full aspect-[4/3] overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
                <img
                  src={p.url}
                  alt={p.label}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
              {p.label && (
                <figcaption className="report-meta mt-1.5 truncate">
                  {p.label}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * Concerns / Watch Items — flat row list. Left border conveys severity.
 * No coloured backgrounds. No nested sub-blocks.
 */
function ConcernsBlock({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {items.map((text, i) => {
        const severity = classifySeverity(text);
        return (
          <div
            key={i}
            className={`pl-3 border-l-[3px] ${severityBorderClass(severity)} py-1`}
          >
            <div className="report-finding-body">{text}</div>
            <div className="report-meta mt-0.5">{severityLabel(severity)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Legacy Space Analysis Card ───────────────────────────────────────────────

function LegacySpaceCard({
  space,
}: {
  space: {
    spaceType?: string;
    score?: number;
    explanation?: string;
    photoCount?: number;
    observations?: string[];
  };
}) {
  const score = space.score ?? 0;

  return (
    <div className="p-4 rounded-xl border border-stone-200 bg-white">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="report-sublabel">
          {getSpaceTypeLabel(space.spaceType ?? '')}
        </div>
        <div className="tabular-nums text-lg font-semibold leading-none text-stone-700">
          {score}
        </div>
      </div>
      {space.photoCount && space.photoCount > 0 && (
        <div className="report-meta mb-2">
          {space.photoCount} photo{space.photoCount !== 1 ? 's' : ''}
        </div>
      )}
      {space.explanation && (
        <div className="report-finding-body line-clamp-2">{space.explanation}</div>
      )}
      {space.observations && space.observations.length > 0 && (
        <ul className="mt-2 space-y-1">
          {space.observations.slice(0, 3).map((obs, j) => (
            <li
              key={j}
              className="flex items-start gap-1.5 report-finding-body"
            >
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
  const {
    photoReview,
    reportMode,
    spaceAnalysis,
    visualAnalysis,
    photos,
    analyzedPhotoCount,
    detectedRooms,
    roomCounts,
  } = raw;

  // Determine if this is a rent report (for rent-flavored text replacements)
  const isRent = reportMode === 'rent';

  // ── Source priority: top-level fields > visualAnalysis.* (nested) ──
  // Step 1 photo analysis may live at either location depending on the
  // report path. The nested visualAnalysis.photoReview / visualAnalysis.spaceAnalysis
  // are the canonical Zillow structured snapshot fields.
  const effectivePhotoReview = photoReview ?? visualAnalysis?.photoReview ?? null;
  const effectiveSpaceAnalysis =
    spaceAnalysis ?? visualAnalysis?.spaceAnalysis ?? null;

  // Check for new Photo Review format
  const hasPhotoReview =
    effectivePhotoReview &&
    (effectivePhotoReview.areas?.length > 0 ||
      effectivePhotoReview.overallSummary);

  // Check for legacy formats
  const hasSpaceAnalysis =
    Array.isArray(effectiveSpaceAnalysis) && effectiveSpaceAnalysis.length > 0;
  const hasVisualRead = visualAnalysis &&
    ((visualAnalysis.renovationLevel &&
      visualAnalysis.renovationLevel !== 'Unknown') ||
      (visualAnalysis.cosmeticFlipRisk &&
        visualAnalysis.cosmeticFlipRisk !== 'Unknown') ||
      (visualAnalysis.naturalLight &&
        visualAnalysis.naturalLight !== 'Unknown') ||
      (visualAnalysis.spacePerception &&
        visualAnalysis.spacePerception !== 'Unknown') ||
      (visualAnalysis.maintenanceCondition &&
        visualAnalysis.maintenanceCondition !== 'Unknown') ||
      (visualAnalysis.maintenanceImpression &&
        visualAnalysis.maintenanceImpression !== 'Unknown') ||
      (visualAnalysis.kitchenCondition &&
        visualAnalysis.kitchenCondition !== 'Unknown') ||
      (visualAnalysis.bathroomCondition &&
        visualAnalysis.bathroomCondition !== 'Unknown'));
  const hasPhotosFallback = Array.isArray(photos) && photos.length > 0;

  if (
    !hasPhotoReview &&
    !hasSpaceAnalysis &&
    !hasVisualRead &&
    !hasPhotosFallback
  ) {
    return null;
  }

  // ── Render New Photo Review Format ──
  if (hasPhotoReview) {
    const { overallSummary, areas, keyTakeaways } = effectivePhotoReview!;
    const { solidSigns, needsAttention, cannotVerify } = keyTakeaways || {};

    // Apply buyer-flavored phrase replacement to the overall summary
    // For sale reports (isRent=false), keep the original text intact.
    const cleanSummary = rentSafeText(overallSummary, isRent);

    // Build concerns list from keyTakeaways + per-area fields, then classify
    const rawConcerns = [
      ...(needsAttention ?? []),
      ...((areas ?? []).flatMap((a) =>
        (a.visibleConcerns ?? []).map((c) => rentSafeText(c, isRent))
      )),
    ]
      .filter(Boolean) as string[];

    const concernsItems = Array.from(new Set(rawConcerns)).filter(
      (t) => t && t.trim().length > 0
    );

    // Build positive signals (drop buyer-flavored)
    const solidItems = (solidSigns ?? [])
      .map((s) => rentSafeText(s, isRent))
      .filter(Boolean) as string[];

    // Build "what photos cannot confirm" — combine cannotVerify + cannotTellFromPhotos
    const verifyItems = [
      ...(cannotVerify ?? []),
      ...((areas ?? []).flatMap((a) =>
        (a.cannotTellFromPhotos ?? [])
          .filter((c) => !hasBuyerFlavor(c))
          .map((c) => rentSafeText(c, isRent))
      )),
    ]
      .filter(Boolean) as string[];

    // Build "next inspection focus" from whatToCheckNext (no buyer-flavored items)
    const nextItems = ((areas ?? []).flatMap((a) =>
      (a.whatToCheckNext ?? [])
        .filter((c) => !hasBuyerFlavor(c))
        .map((c) => rentSafeText(c, isRent))
    )).filter(Boolean) as string[];

    const mergedAreas = mergePhotoReviewAreas(areas ?? []);

    return (
      <section
        aria-labelledby="photo-condition-review-heading"
        className="report-space-section"
      >
        <div className="report-section">
          {/* Header */}
          <div id="photo-condition-review-heading">
            <SectionHeader
              title={
                effectivePhotoReview!.moduleTitle || 'Photo & Condition Review'
              }
              subtitle={
                effectivePhotoReview!.moduleSubtitle ||
                'AI review of visible condition, finishes, maintenance signals, and what photos alone cannot confirm.'
              }
            />
          </div>

          {/* 1. Overall Visual Summary */}
          <OverallSummaryCallout summary={cleanSummary} />

        {/* 2. Key Visual Findings */}
        {mergedAreas.length > 0 && (
          <div className="mb-8">
            <SubSectionHeading
              eyebrow="02"
              title="Key Visual Findings"
              hint={
                mergedAreas.length === 1
                  ? '1 finding drawn from the listing photos.'
                  : `${mergedAreas.length} findings drawn from the listing photos.`
              }
            />
            <div className="space-y-3">
              {mergedAreas.map((area) => (
                <FindingRow
                  key={`${area.area ?? area.areaType ?? area.spaceType ?? 'unknown'}-${area.unit ?? area.unitNumber ?? area.floor ?? area.floorNumber ?? area.subject ?? ''}`}
                  area={area}
                  evidencePhotos={pickEvidencePhotos(area, photos, 3)}
                  isRent={isRent}
                />
              ))}
            </div>
          </div>
        )}

        {/* 3. Concerns & Watch Items */}
        {concernsItems.length > 0 && (
          <div className="mb-8">
            <SubSectionHeading
              eyebrow="03"
              title="Concerns & Watch Items"
              hint="Items worth flagging before you commit."
            />
            <ConcernsBlock items={concernsItems} />
          </div>
        )}

        {/* 4. Positive Signals */}
        {solidItems.length > 0 && (
          <div className="mb-8">
            <SubSectionHeading eyebrow="04" title="Positive Signals" />
            <InlineList items={solidItems} />
          </div>
        )}

        {/* 5. What Photos Cannot Confirm */}
        {verifyItems.length > 0 && (
          <div className="mb-8">
            <SubSectionHeading
              eyebrow="05"
              title="What Photos Cannot Confirm"
              hint="These items need an in-person check — not a deal-breaker, but worth verifying before you commit."
            />
            <InlineList items={verifyItems} />
          </div>
        )}

        {/* 6. Next Inspection Focus */}
        {nextItems.length > 0 && (
          <div className="mb-8">
            <SubSectionHeading
              eyebrow="06"
              title="Next Inspection Focus"
              hint="What to verify during the showing or with a home inspector."
            />
            <InlineList items={nextItems} />
          </div>
        )}
      </div>
      </section>
    );
  }

  // ── Render Legacy Format (Backward Compatibility) ──
  const summaryItems: Array<{ label: string; value: string }> = [];
  if (analyzedPhotoCount != null && analyzedPhotoCount > 0) {
    summaryItems.push({
      label: 'Photos analysed',
      value: String(analyzedPhotoCount),
    });
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
      if (val && val !== 'Unknown' && val.trim())
        visualItems.push({ label, value: val });
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
    ? effectiveSpaceAnalysis!.map((space) => ({
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

  return (
    <section
      aria-labelledby="photo-condition-review-heading-legacy"
      className="report-space-section"
    >
      <div className="report-section">
        {/* Header */}
        <div id="photo-condition-review-heading-legacy">
          <SectionHeader
            title="Photo & Space Analysis"
            subtitle="What the listing photos reveal about condition, layout and liveability"
          />
        </div>

        {/* A. Summary Row */}
        {summaryItems.length > 0 && (
          <OverallSummaryCallout
            summary={summaryItems.map((item) => `${item.label}: ${item.value}`).join(' • ')}
          />
        )}

        {/* B. Visual Read indicators */}
      {visualItems.length > 0 && (
        <div className="mb-8">
          <SubSectionHeading eyebrow="02" title="Key Visual Readings" />
          <div className="grid grid-cols-2 @container/sz-400:grid-cols-3 gap-2">
            {visualItems.map((item, i) => (
              <div key={i} className="p-3 bg-white rounded-xl border border-stone-200">
                <div className="report-meta uppercase tracking-wider mb-1">
                  {item.label}
                </div>
                <div className="report-finding-body font-semibold text-stone-900 leading-snug">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
          {visualAnalysis?.photoObservations &&
            visualAnalysis.photoObservations.length > 0 && (
              <div className="mt-3">
                <InlineList
                  items={visualAnalysis.photoObservations.slice(0, 3)}
                />
              </div>
            )}
        </div>
      )}

      {/* C. Space Cards */}
      {spaceCards.length > 0 && (
        <div className="mb-8">
          <SubSectionHeading eyebrow="03" title="Area Signals" />
          <div className="grid grid-cols-1 @container/sz-500:grid-cols-2 gap-3">
            {spaceCards.map((card, i) => (
              <LegacySpaceCard key={i} space={card} />
            ))}
          </div>
        </div>
      )}

      {/* D. Fallback: photo-level summaries */}
      {fallbackPhotos.length > 0 && (
        <div className="mb-8">
          <SubSectionHeading eyebrow="03" title="Photo Notes" />
          <div className="grid grid-cols-2 @container/sz-500:grid-cols-3 gap-3">
            {fallbackPhotos.map((photo, i) => (
              <div
                key={i}
                className="p-3 rounded-xl border border-stone-200 bg-white"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="report-sublabel">{photo.label}</span>
                  <span className="tabular-nums text-base font-semibold leading-none text-stone-700">
                    {photo.score}
                  </span>
                </div>
                {photo.summary && (
                  <div className="report-finding-body line-clamp-2">
                    {photo.summary}
                  </div>
                )}
                {photo.signals.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {photo.signals.map((s, j) => (
                      <div key={j} className="report-meta truncate">
                        + {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing Key Areas */}
      {visualAnalysis?.missingKeyAreas &&
        visualAnalysis.missingKeyAreas.length > 0 && (
          <div className="mt-6">
            <SubSectionHeading eyebrow="05" title="No Photos Found" />
            <div className="pl-3 border-l-[3px] border-l-stone-500 py-1">
              <div className="report-finding-body">
                {visualAnalysis.missingKeyAreas.join(', ')}
              </div>
              <div className="report-meta mt-0.5">Informational</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}