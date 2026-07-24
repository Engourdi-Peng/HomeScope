// ── Interior photo detection ───────────────────────────────────────────────────
// Shared helper used by both the rent adapter (usRent.ts) and the report viewModel
// (reportViewModel.ts) to decide whether the listing has interior-room evidence.
//
// Why a shared helper?
// The two adapters previously read from different data sources and disagreed:
//   - usRent.ts read `result.photo_habitability_review.unit_specific_evidence[]`
//     (Step 2 string list)
//   - reportViewModel.ts read `raw.spaceAnalysis.areas[]` / `detectedAreas[]`
//     (Step 1 structured output)
//
// When Step 1 detected "kitchen, bedroom" but Step 2's string list was empty,
// the report rendered the visual analysis cards (from viewModel) AND the
// "No interior photos available" fallback (from usRent.ts) — a contradictory
// "we have photos AND we don't have photos" UX.
//
// This helper cross-checks all three sources (Step 1 areas, Step 2 evidence,
// and the raw imageUrls array). It is the single source of truth so the two
// adapters cannot disagree.

const INTERIOR_AREAS = [
  'living room', 'bedroom', 'bathroom', 'kitchen',
  'hallway', 'dining room', 'basement', 'storage',
  'attic', 'laundry', 'office', 'family room',
];

/**
 * Extract and normalize an area name from a raw entry.
 *
 * photoReview.areas may be:
 *   - string[]               → ["kitchen", "bedroom"]
 *   - object[] with .area    → [{ area: "living_room", confidence: "Medium" }, ...]
 *   - object[] with .name    → [{ name: "Kitchen" }]
 *   - object[] with .label   → [{ label: "kitchen" }]
 *   - object[] with .type    → [{ type: "kitchen" }]
 *
 * Field priority: area > name > label > type.
 * Strings like "living_room" / "dining-room" are normalized to "living room" /
 * "dining room" so they match INTERIOR_AREAS keywords.
 *
 * IMPORTANT: this only reads the dedicated area fields. It never stringifies
 * the full object, so descriptive text fields like `description`, `concerns`,
 * or `summary` cannot accidentally flip a non-interior area into an interior.
 */
function normalizeAreaName(value: unknown): string {
  let raw = '';

  if (typeof value === 'string') {
    raw = value;
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const candidate =
      obj.area ?? obj.name ?? obj.label ?? obj.type ?? '';
    if (typeof candidate === 'string') {
      raw = candidate;
    }
  }

  return raw
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface InteriorDetectionSources {
  step1Areas?: unknown;
  step1DetectedAreas?: unknown;
  photoReview?: { areas?: unknown[]; detectedAreas?: unknown[] };
  visualAnalysis?: { areas?: unknown[]; detectedAreas?: unknown[] };
  photoHabitabilityReview?: { unit_specific_evidence?: unknown[]; habitability_signals?: unknown[] };
  imageUrls?: unknown;
}

/**
 * Decide whether the listing has any interior-room photo evidence.
 *
 * Inputs: any combination of Step 1 area lists, Step 2 string evidence, and
 * raw image URLs. Returns true if ANY source shows at least one interior room.
 */
export function hasInteriorPhotos(sources: InteriorDetectionSources = {}): boolean {
  const imageUrls = Array.isArray(sources.imageUrls) ? sources.imageUrls : [];
  if (imageUrls.length === 0) {
    // No raw URLs — but the LLM may still have seen photos via embedded
    // image_url messages. Keep checking the structured outputs.
  }

  // Source 1: Step 1 structured area detection (most authoritative)
  const step1AreasRaw: unknown[] = [
    ...(Array.isArray(sources.step1Areas) ? (sources.step1Areas as unknown[]) : []),
    ...(Array.isArray(sources.step1DetectedAreas) ? (sources.step1DetectedAreas as unknown[]) : []),
    ...(Array.isArray(sources.photoReview?.areas) ? (sources.photoReview!.areas as unknown[]) : []),
    ...(Array.isArray(sources.photoReview?.detectedAreas) ? (sources.photoReview!.detectedAreas as unknown[]) : []),
    ...(Array.isArray(sources.visualAnalysis?.areas) ? (sources.visualAnalysis!.areas as unknown[]) : []),
    ...(Array.isArray(sources.visualAnalysis?.detectedAreas) ? (sources.visualAnalysis!.detectedAreas as unknown[]) : []),
  ];
  const areasLower = step1AreasRaw
    .map(normalizeAreaName)
    .filter((s) => s.length > 0);
  const step1HasInterior = areasLower.some((a) =>
    INTERIOR_AREAS.some((kw) => a.includes(kw))
  );
  if (step1HasInterior) return true;

  // Source 2: Step 2 string evidence — keywords that strongly suggest
  // the LLM saw the inside of the unit, even if the area list wasn't emitted.
  const step2StringsRaw: unknown[] = [
    ...(Array.isArray(sources.photoHabitabilityReview?.unit_specific_evidence)
      ? (sources.photoHabitabilityReview!.unit_specific_evidence as unknown[])
      : []),
    ...(Array.isArray(sources.photoHabitabilityReview?.habitability_signals)
      ? (sources.photoHabitabilityReview!.habitability_signals as unknown[])
      : []),
  ];
  const step2Text = step2StringsRaw
    .map((s) => (typeof s === 'string' ? s : typeof s === 'object' && s ? JSON.stringify(s) : ''))
    .join(' ')
    .toLowerCase();
  const step2HasInterior = INTERIOR_AREAS.some((kw) => step2Text.includes(kw));
  if (step2HasInterior) return true;

  // Source 3: We have raw image URLs at all. The LLM at minimum saw them
  // even if the structured output is sparse. We can't claim "no interior photos"
  // without contradicting the fact that photos exist.
  if (imageUrls.length > 0) return true;

  return false;
}

export const INTERIOR_AREAS_LIST = INTERIOR_AREAS;