export interface PhotoReviewAreaRecord extends Record<string, unknown> {
  area?: string;
  areaType?: string;
  spaceType?: string;
  name?: string;
  label?: string;
  type?: string;
  photoCount?: number;
  confidence?: string;
}

const AREA_IDENTITY_FIELDS = [
  'unit', 'unitId', 'unitNumber', 'unitLabel',
  'floor', 'floorNumber', 'floorLabel', 'level',
  'subject', 'subjectId', 'subjectLabel',
] as const;

function normalizeValue(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
    : typeof value === 'number' ? String(value) : '';
}

export function photoReviewAreaKey(area: PhotoReviewAreaRecord, fallbackIndex: number): string {
  const name = normalizeValue(
    area.area ?? area.areaType ?? area.spaceType ?? area.name ?? area.label ?? area.type,
  );
  const identity = AREA_IDENTITY_FIELDS
    .map((field) => [field, normalizeValue(area[field])] as const)
    .filter(([, value]) => value.length > 0)
    .map(([field, value]) => `${field}=${value}`)
    .join('|');
  return name ? `${name}${identity ? `|${identity}` : ''}` : `__unknown_area_${fallbackIndex}`;
}

function mergeTextList(current: unknown, incoming: unknown): string[] {
  const values = [current, incoming]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeAreaRecords(
  current: PhotoReviewAreaRecord,
  incoming: PhotoReviewAreaRecord,
): PhotoReviewAreaRecord {
  const merged = { ...current };
  const currentCount = typeof current.photoCount === 'number' && current.photoCount > 0 ? current.photoCount : 0;
  const incomingCount = typeof incoming.photoCount === 'number' && incoming.photoCount > 0 ? incoming.photoCount : 0;
  if (currentCount + incomingCount > 0) merged.photoCount = currentCount + incomingCount;

  for (const field of ['visibleConcerns', 'cannotTellFromPhotos', 'whatToCheckNext'] as const) {
    const values = mergeTextList(current[field], incoming[field]);
    if (values.length > 0) merged[field] = values;
  }
  const descriptions = mergeTextList(current.whatLooksLike, incoming.whatLooksLike);
  if (descriptions.length > 0) merged.whatLooksLike = descriptions.join(' ');

  const confidenceRank: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const currentConfidence = normalizeValue(current.confidence);
  const incomingConfidence = normalizeValue(incoming.confidence);
  if (currentConfidence || incomingConfidence) {
    const conservative = confidenceRank[currentConfidence] <= confidenceRank[incomingConfidence]
      ? current.confidence
      : incoming.confidence;
    if (conservative) merged.confidence = conservative;
  }
  return merged;
}

export function mergePhotoReviewAreas(
  areas: PhotoReviewAreaRecord[],
): PhotoReviewAreaRecord[] {
  const merged = new Map<string, PhotoReviewAreaRecord>();
  areas.forEach((area, index) => {
    const key = photoReviewAreaKey(area, index);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeAreaRecords(existing, area) : { ...area });
  });
  return Array.from(merged.values());
}
