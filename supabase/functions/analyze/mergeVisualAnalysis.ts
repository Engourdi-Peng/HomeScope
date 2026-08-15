/**
 * Visual analysis batch merger for Step 1 photo review.
 *
 * This is the single source of truth for the additive photo-batch merge
 * strategy used by the multi-unit building rent pipeline. It is exposed
 * as a standalone module so the vitest regression matrix in
 * `mergeVisualAnalysis.test.ts` can exercise it directly. The Edge Function
 * (`supabase/functions/analyze/index.ts`) must keep its inlined copy in
 * lock-step with this implementation and call it from the main pipeline.
 *
 * Policy (deterministic, no AI, no fallback fabrication):
 *   - photos: concatenated across batches. Each batch's photoIndex is the
 *     caller's responsibility — this function does NOT rebase indices.
 *   - spaceAnalysis: merged by spaceType. Duplicate space types have their
 *     observations union-deduped (capped at 5) and their scores averaged.
 *     No observation is dropped on merge.
 *   - photoReview.areas: merged by normalized area identity. Same-area entries
 *     are combined across batches; explicit unit, floor, or subject identities
 *     remain separate records.
 *   - photoReview.keyTakeaways.{solidSigns,cannotVerify,needsAttention}:
 *     appended in batch order, deduped only on exact-string match.
 *   - photoReview.{moduleTitle, moduleSubtitle}: first non-empty value wins.
 *   - photoReview.overallSummary: picks the summary from the batch whose
 *     photoReview.areas have the largest total photoCount. No synthetic
 *     text is generated when none of the batches produced a summary.
 *   - Any other top-level key in photoReview is carried over verbatim from
 *     the first non-empty review (preserves additive schema extensions).
 *
 * Generic contract — no listing/address/unit/photo-count-specific behaviour.
 */

export interface BatchResult {
  photos?: Array<Record<string, unknown>>;
  spaceAnalysis?: Array<Record<string, unknown>>;
  photoReview?: Record<string, unknown>;
}

export interface MergedVisualAnalysis extends Record<string, unknown> {
  photos: Array<Record<string, unknown>>;
  spaceAnalysis: Array<Record<string, unknown>>;
  photoReview?: Record<string, unknown>;
}

const AREA_IDENTITY_FIELDS = [
  'unit', 'unitId', 'unitNumber', 'unitLabel',
  'floor', 'floorNumber', 'floorLabel', 'level',
  'subject', 'subjectId', 'subjectLabel',
] as const;

function normalizeAreaValue(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\\s_-]+/g, ' ')
    : typeof value === 'number' ? String(value) : '';
}

function areaIdentityKey(area: Record<string, unknown>, fallbackIndex: number): string {
  const areaName = normalizeAreaValue(
    area.area ?? area.areaType ?? area.spaceType ?? area.name ?? area.label ?? area.type,
  );
  const identity = AREA_IDENTITY_FIELDS
    .map((field) => [field, normalizeAreaValue(area[field])] as const)
    .filter(([, value]) => value.length > 0)
    .map(([field, value]) => `${field}=${value}`)
    .join('|');

  return areaName
    ? `${areaName}${identity ? `|${identity}` : ''}`
    : `__unknown_area_${fallbackIndex}`;
}

function mergeTextList(
  current: unknown,
  incoming: unknown,
): string[] {
  const values = [current, incoming]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase().replace(/\\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeAreaRecords(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...current };
  const currentCount = typeof current.photoCount === 'number' && current.photoCount > 0 ? current.photoCount : 0;
  const incomingCount = typeof incoming.photoCount === 'number' && incoming.photoCount > 0 ? incoming.photoCount : 0;
  if (currentCount + incomingCount > 0) merged.photoCount = currentCount + incomingCount;

  for (const field of ['visibleConcerns', 'cannotTellFromPhotos', 'whatToCheckNext']) {
    const values = mergeTextList(current[field], incoming[field]);
    if (values.length > 0) merged[field] = values;
  }

  const descriptions = mergeTextList(current.whatLooksLike, incoming.whatLooksLike);
  if (descriptions.length > 0) merged.whatLooksLike = descriptions.join(' ');

  const confidenceRank: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const currentConfidence = normalizeAreaValue(current.confidence);
  const incomingConfidence = normalizeAreaValue(incoming.confidence);
  if (currentConfidence || incomingConfidence) {
    const conservative = confidenceRank[currentConfidence] <= confidenceRank[incomingConfidence]
      ? current.confidence
      : incoming.confidence;
    if (conservative) merged.confidence = conservative;
  }

  return merged;
}

export function mergePhotoReviewAreas(
  areas: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  areas.forEach((area, index) => {
    const key = areaIdentityKey(area, index);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeAreaRecords(existing, area) : { ...area });
  });
  return Array.from(merged.values());
}

export function mergeVisualAnalysis(
  results: BatchResult[],
): MergedVisualAnalysis {
  const allPhotos: Array<Record<string, unknown>> = [];
  const spaceAnalysisMap = new Map<string, Record<string, unknown>>();

  for (const result of results) {
    if (!result) continue;

    if (Array.isArray(result.photos)) {
      for (const photo of result.photos) {
        allPhotos.push({ ...photo });
      }
    }

    if (Array.isArray(result.spaceAnalysis)) {
      for (const space of result.spaceAnalysis) {
        const spaceType = space.spaceType as string;
        if (spaceType && spaceAnalysisMap.has(spaceType)) {
          const existing = spaceAnalysisMap.get(spaceType)!;
          const existingObs = (existing.observations as string[]) || [];
          const newObs = (space.observations as string[]) || [];
          existing.observations = [
            ...new Set([...existingObs, ...newObs]),
          ].slice(0, 5);
          const existingScore = (existing.score as number) || 0;
          const newScore = (space.score as number) || 0;
          existing.score = Math.round((existingScore + newScore) / 2);
        } else {
          spaceAnalysisMap.set(spaceType, { ...space });
        }
      }
    }
  }

  const reviewsWithAreas: Array<{
    review: Record<string, unknown>;
    areas: Array<Record<string, unknown>>;
    totalPhotoCount: number;
  }> = [];
  let firstNonEmptyReview: Record<string, unknown> | null = null;
  for (const result of results) {
    const review = result?.photoReview;
    if (!review || typeof review !== 'object' || Object.keys(review).length === 0) continue;
    if (!firstNonEmptyReview) firstNonEmptyReview = review as Record<string, unknown>;
    const rawAreas = Array.isArray((review as Record<string, unknown>).areas)
      ? ((review as Record<string, unknown>).areas as Array<Record<string, unknown>>)
      : [];
    let totalPhotoCount = 0;
    for (const area of rawAreas) {
      if (!area || typeof area !== 'object') continue;
      const pc = (area as Record<string, unknown>).photoCount;
      if (typeof pc === 'number' && Number.isFinite(pc) && pc > 0) {
        totalPhotoCount += pc;
      }
    }
    reviewsWithAreas.push({
      review: review as Record<string, unknown>,
      areas: rawAreas,
      totalPhotoCount,
    });
  }

  let photoReview: Record<string, unknown> | null = null;
  if (reviewsWithAreas.length > 0) {
    const merged: Record<string, unknown> = {};

    for (const key of ['moduleTitle', 'moduleSubtitle']) {
      for (const r of reviewsWithAreas) {
        const v = (r.review as Record<string, unknown>)[key];
        if (typeof v === 'string' && v.trim().length > 0) {
          merged[key] = v;
          break;
        }
      }
    }

    const allAreas: Array<Record<string, unknown>> = [];
    for (const r of reviewsWithAreas) {
      for (const area of r.areas) {
        if (area && typeof area === 'object') allAreas.push(area);
      }
    }
    merged.areas = mergePhotoReviewAreas(allAreas);

    const KEY_FIELDS = ['solidSigns', 'cannotVerify', 'needsAttention'];
    const takeawaysBase = (firstNonEmptyReview as Record<string, unknown>).keyTakeaways;
    const takeawaysOut: Record<string, unknown> = {};
    if (takeawaysBase && typeof takeawaysBase === 'object') {
      for (const k of Object.keys(takeawaysBase as Record<string, unknown>)) {
        takeawaysOut[k] = [];
      }
    }
    for (const k of KEY_FIELDS) takeawaysOut[k] = [];
    for (const r of reviewsWithAreas) {
      const kt = (r.review as Record<string, unknown>).keyTakeaways;
      if (!kt || typeof kt !== 'object') continue;
      for (const k of KEY_FIELDS) {
        const arr = (kt as Record<string, unknown>)[k];
        if (!Array.isArray(arr)) continue;
        const seen = new Set(
          ((takeawaysOut[k] as unknown[]) || []).map((s) =>
            typeof s === 'string' ? s : JSON.stringify(s),
          ),
        );
        for (const item of arr) {
          if (typeof item !== 'string') continue;
          if (item.trim().length === 0) continue;
          if (seen.has(item)) continue;
          seen.add(item);
          (takeawaysOut[k] as string[]).push(item);
        }
      }
    }
    const takeawaysClean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(takeawaysOut)) {
      if (Array.isArray(v) && v.length > 0) takeawaysClean[k] = v;
    }
    if (Object.keys(takeawaysClean).length > 0) merged.keyTakeaways = takeawaysClean;

    let bestSummary: string | null = null;
    let bestCoverage = -1;
    for (const r of reviewsWithAreas) {
      const summary = (r.review as Record<string, unknown>).overallSummary;
      if (typeof summary !== 'string' || summary.trim().length === 0) continue;
      if (r.totalPhotoCount > bestCoverage) {
        bestCoverage = r.totalPhotoCount;
        bestSummary = summary;
      }
    }
    if (bestSummary !== null) merged.overallSummary = bestSummary;

    for (const [k, v] of Object.entries(firstNonEmptyReview as Record<string, unknown>)) {
      if (k === 'moduleTitle' || k === 'moduleSubtitle') continue;
      if (k === 'areas') continue;
      if (k === 'keyTakeaways') continue;
      if (k === 'overallSummary') continue;
      merged[k] = v;
    }
    photoReview = merged;
  }

  return {
    photos: allPhotos,
    spaceAnalysis: Array.from(spaceAnalysisMap.values()),
    ...(photoReview && { photoReview }),
  };
}
