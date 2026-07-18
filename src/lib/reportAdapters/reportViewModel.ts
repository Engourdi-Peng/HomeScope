// ===== reportViewModel — 结果页数据标准化层 =====
// 把原始 listing 数据、AI 输出、前端模板统一处理成稳定的展示数据.
// JSX 只从 viewModel 取值，不直接访问 AI 原始字段.
// 包含 5 大一致性校验规则.

import type { ContradictionVM } from './types';
import {
  MODULE_FALLBACKS,
  RISK_ACTION_FALLBACKS,
  QUESTION_FALLBACKS,
  QUESTIONS_TO_SUPPRESS_BY_CATEGORY,
} from './Fallbacks';
import { INTERIOR_AREAS_LIST, hasInteriorPhotos as hasInteriorPhotosShared } from './interiorPhotos';

const CORE_FACT_FIELDS = ['address', 'year', 'propertyType', 'beds', 'baths', 'sqft', 'pricePerSqft'] as const;

// ── 通用工具 ──────────────────────────────────────────────────────────────────

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'function') return '';
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['title', 'label', 'name', 'heading', 'value', 'summary',
      'description', 'detail', 'text', 'reason', 'risk', 'signal',
      'action', 'recommendation']) {
      const t = toText(obj[key]);
      if (t) return t;
    }
    return '';
  }
  return '';
}

function fmtMoney(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return '$' + val.toLocaleString();
  }
  return toText(val);
}

function fmtSqft(val: unknown): string {
  // Already formatted — pass through
  if (typeof val === 'string') {
    if (val.startsWith('$') || /sqft/i.test(val)) return val;
    const num = parseFloat(val.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(num)) return num.toLocaleString() + ' sqft';
    return val;
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val.toLocaleString() + ' sqft';
  }
  return toText(val);
}

function extractImageUrls(raw: any): string[] {
  const candidates = [
    raw?.listingInfo?.images, raw?.listingInfo?.photos,
    raw?.listingInfo?.photoUrls, raw?.listingInfo?.imageUrls,
    raw?.images, raw?.photos,
    raw?.photoUrls, raw?.photo_urls,
    raw?.imageUrls, raw?.image_urls,
  ];
  const result: string[] = [];
  for (const arr of candidates) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const url = typeof item === 'string' ? item.trim()
        : typeof item === 'object' && item !== null
          ? String((item as Record<string, unknown>).url ?? (item as Record<string, unknown>).src ?? '')
          : '';
      if (url.startsWith('http') && !/icon|logo|avatar|placeholder|default|1x1|pixel|blank/i.test(url)) {
        result.push(url);
      }
    }
  }
  return result;
}

// ── 数据底座优先 ─────────────────────────────────────────────────────────────

function preferRawFact<T>(...values: T[]): T {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return values[values.length - 1];
}

function parseNumeric(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtCompactMillions(value: unknown): string {
  const num = parseNumeric(value);
  if (num == null || num <= 0) return toText(value);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}M`;
  return `$${num.toLocaleString()}`;
}

function normalizeBathDisplay(value: unknown): string {
  const text = toText(value);
  if (!text) return '';
  return text.replace(/\.0\b/, '');
}

function extractCoreFacts(raw: any, listingInfo?: any) {
  const snap = raw?.property_snapshot ?? {};
  const address = toText(preferRawFact(
    listingInfo?.address,
    raw?.listingInfo?.address,
    raw?.listingOverview?.address,
    snap?.address,
    raw?.address,
  ));
  const year = toText(preferRawFact(
    snap?.yearBuilt,
    snap?.year_built,
    listingInfo?.yearBuilt,
    raw?.yearBuilt,
  ));
  const beds = toText(preferRawFact(
    listingInfo?.bedrooms,
    listingInfo?.beds,
    snap?.beds,
    snap?.bedrooms,
    raw?.beds,
  ));
  const baths = normalizeBathDisplay(preferRawFact(
    listingInfo?.bathrooms,
    listingInfo?.baths,
    snap?.baths,
    snap?.bathrooms,
    raw?.baths,
  ));
  const sqft = toText(preferRawFact(
    snap?.sqft,
    snap?.squareFeet,
    snap?.square_feet,
    listingInfo?.sqft,
    listingInfo?.floorArea,
    raw?.sqft,
  ));
  const propertyType = toText(preferRawFact(
    raw?.displayType,
    raw?.property_snapshot?.homeType,
    raw?.property_snapshot?.home_type,
    listingInfo?.propertyType,
    raw?.propertyType,
    raw?.homeType,
  ));
  const price = toText(preferRawFact(
    snap?.asking_price,
    snap?.askingPrice,
    snap?.price,
    listingInfo?.price,
    raw?.price,
    raw?.askingPrice,
  ));
  const pricePerSqft = toText(preferRawFact(
    snap?.price_per_sqft_display,
    snap?.price_per_sqft,
    snap?.pricePerSqft,
    raw?.pricePerSqft,
  ));
  const descriptionText = [
    raw?.listingInfo?.description,
    raw?.listingOverview?.description,
    raw?.description,
    raw?.listingInfo?.highlights,
  ].map(toText).join(' ');
  const basementFinishedExplicit = /basement\s*:\s*finished|finished basement|fully finished basement/i.test(descriptionText);
  const basementMention = /full basement|basement|cellar|lower level/i.test(descriptionText);
  const drivewayMention = /driveway|long driveway|private drive/i.test(descriptionText);
  const yardMention = /yard|backyard|front yard|rear yard|outdoor space/i.test(descriptionText);
  const officeMention = /office|den|bonus room/i.test(descriptionText);
  const hasZestimate = parseNumeric(raw?.zestimate ?? snap?.zestimate ?? raw?.price_assessment?.zestimate) != null;
  const hasSalesRange = parseNumeric(raw?.price_assessment?.estimated_min ?? raw?.price_assessment?.estimatedMin) != null
    || parseNumeric(raw?.price_assessment?.estimated_max ?? raw?.price_assessment?.estimatedMax) != null;
  return {
    address,
    year,
    beds,
    baths,
    sqft,
    propertyType,
    price,
    pricePerSqft,
    basementFinishedExplicit,
    basementMention,
    drivewayMention,
    yardMention,
    officeMention,
    hasZestimate,
    hasSalesRange,
  };
}

function aiSummaryConflictsWithFacts(summary: string, facts: ReturnType<typeof extractCoreFacts>): boolean {
  const text = toText(summary).toLowerCase();
  if (!text) return false;
  const checks: Array<{ field: typeof CORE_FACT_FIELDS[number]; expected: string; pattern: RegExp }> = [
    { field: 'year', expected: facts.year, pattern: /(19|20)\d{2}/g },
    { field: 'beds', expected: facts.beds, pattern: /(\d+(?:\.\d+)?)\s*beds?/g },
    { field: 'baths', expected: facts.baths, pattern: /(\d+(?:\.\d+)?)\s*baths?/g },
    { field: 'sqft', expected: facts.sqft, pattern: /(\d{3,5})\s*sq\s*ft/g },
  ];
  for (const check of checks) {
    if (!check.expected) continue;
    const matches = Array.from(text.matchAll(check.pattern)).map((m) => m[1]);
    if (matches.length > 0 && !matches.some((m) => String(m) === String(check.expected).replace(/,/g, ''))) {
      return true;
    }
  }
  if (facts.propertyType && /ranch/i.test(text) && !/ranch/i.test(facts.propertyType.toLowerCase())) return true;
  if (facts.propertyType && /cape cod|cape/i.test(text) && !/cape/i.test(facts.propertyType.toLowerCase())) return true;
  if (facts.address) {
    const addressCore = facts.address.toLowerCase().split(',')[0].trim();
    if (addressCore && /\d{2,5}\s+[a-z0-9 .'-]+/i.test(text) && !text.includes(addressCore)) return true;
  }
  return false;
}

function buildSingleFamilyBottomLine(raw: any, facts: ReturnType<typeof extractCoreFacts>): string {
  const location = facts.address.split(',')[1]?.trim() || facts.address.split(',')[0]?.trim() || 'this property';
  const featureBits = [
    facts.beds ? `${facts.beds} beds` : '',
    facts.baths ? `${facts.baths} baths` : '',
    facts.basementFinishedExplicit ? 'finished basement' : facts.basementMention ? 'basement' : '',
    facts.drivewayMention ? 'long driveway' : '',
    facts.yardMention ? 'yard' : '',
    !facts.basementMention && facts.officeMention ? 'office space' : '',
  ].filter(Boolean);
  const introBits = [facts.year, facts.propertyType, location].filter(Boolean);
  const intro = introBits.length > 0 ? `${introBits.join(' ')} with ${featureBits.join(', ')}` : featureBits.join(', ');
  const asking = facts.price ? `Asking ${fmtCompactMillions(facts.price)}` : 'The asking price';
  const psf = facts.pricePerSqft ? ` at ${facts.pricePerSqft}` : '';
  const needsHighPriceWarning = /\$?8\d\d\/?sq?f?t?/i.test(facts.pricePerSqft) || (parseNumeric(facts.pricePerSqft) ?? 0) >= 800;
  const priceClause = needsHighPriceWarning
    ? `${asking}${psf} is high for the size`
    : `${asking}${psf} still needs nearby comparable sales support`;
  const verifyItems = ['comparable sales', 'basement use and permits', 'roof age', 'major systems'];
  return `${intro}. ${priceClause}, so verify ${verifyItems.join(', ')} before committing.`
    .replace(/\s+,/g, ',')
    .replace(/with ([^.]+), ([^.]+), and ([^.]+)\./, 'with $1, $2, and $3.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function tightenSingleFamilyScore(rawScore: number | null, raw: any, facts: ReturnType<typeof extractCoreFacts>): number | null {
  if (rawScore == null) return rawScore;
  const isSingleFamily = /single_family_owner_occupier|single_family/.test(String(raw?.normalizedPropertyCategory ?? raw?.reportProfile ?? ''));
  if (!isSingleFamily) return rawScore;
  const pricePerSqft = parseNumeric(facts.pricePerSqft) ?? 0;
  const hasHighPsf = pricePerSqft >= 800;
  const noValuationAnchors = !facts.hasZestimate && !facts.hasSalesRange;
  const descriptionText = [raw?.listingInfo?.description, raw?.description, raw?.quickSummary, raw?.quick_summary].map(toText).join(' ').toLowerCase();
  const fourBedroomMarketing = /totally\s*4\s*bedrooms|4\s*bedrooms?/i.test(descriptionText) && String(facts.beds) === '3';
  const basementLegalRisk = /finished basement|basement|cellar|lower level/i.test(descriptionText);
  const olderHome = (() => {
    const year = parseNumeric(facts.year);
    return year != null && year <= 1965;
  })();
  if (hasHighPsf && noValuationAnchors && basementLegalRisk && olderHome) {
    let tightened = Math.min(rawScore, 70);
    if (fourBedroomMarketing) tightened = Math.min(tightened, 69);
    return tightened;
  }
  return rawScore;
}

// ── Contradiction Detection ─────────────────────────────────────────────────────

let _contradictionId = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++_contradictionId}`;
}

/**
 * Detect contradictions between structured facts and listing descriptions.
 * Each contradiction is surfaced in the report as a "What to Verify" item.
 */
export function detectContradictions(raw: any): ContradictionVM[] {
  const contradictions: ContradictionVM[] = [];

  const snap = raw?.property_snapshot ?? {};
  const normCat = raw?.normalizedPropertyCategory ?? raw?.reportProfile ?? 'unknown';
  const displayType = raw?.displayType ?? normCat;
  const description = [
    raw?.listingInfo?.description ?? '',
    raw?.description ?? '',
    (raw as any).listingOverview?.description ?? '',
    (raw as any).listingInfo?.highlights ?? '',
  ].join(' ').toLowerCase();

  const beds = snap.beds ?? snap.bedrooms;
  const hoa = snap.hoa ?? (raw as any).hoa;
  const hoaAmount = snap.hoaAmount ?? (raw as any).hoaAmount;
  const daysOnMarket = snap.daysOnMarket ?? snap.days_on_market ?? (raw as any).daysOnMarket;
  const price = parseFloat(String(snap.price ?? (raw as any).price ?? snap.asking_price ?? (raw as any).askingPrice ?? ''));
  const zestimate = parseFloat(String(snap.zestimate ?? (raw as any).zestimate ?? ''));

  // 1. Beds mismatch: description mentions "two-bedroom" but beds=1 (or vice versa)
  const bedsMentioned = /two.bedroom|2 bed|2-bedroom/i.test(description) ? 2
    : /one.bedroom|1 bed|1-bedroom/i.test(description) ? 1
    : /three.bedroom|3 bed|3-bedroom/i.test(description) ? 3
    : /four.bedroom|4 bed|4-bedroom/i.test(description) ? 4
    : null;
  if (bedsMentioned !== null && beds != null && bedsMentioned !== beds) {
    contradictions.push({
      id: nextId('beds-mismatch'),
      severity: 'high',
      description: `Listing description may refer to ${bedsMentioned} bedroom(s), but structured data shows ${beds} bedroom(s).`,
      field1: `Structured facts: ${beds} bed`,
      field2: `Listing text: ${bedsMentioned} bed`,
      suggestion: 'Verify the actual bedroom count against the listing description and public records before viewing.',
    });
  }

  // 2. Co-op maintenance missing: HOA N/A or unknown but property is co-op
  if (normCat === 'co_op') {
    if (hoa === 'unknown' || hoaAmount == null) {
      contradictions.push({
        id: nextId('coop-maintenance-missing'),
        severity: 'high',
        description: 'This is a co-op listing but monthly maintenance fee is not disclosed.',
        field1: 'Property type: Co-op',
        field2: 'Monthly maintenance: Not disclosed',
        suggestion: 'Do not rely on the low price without first confirming the monthly maintenance fee — it can significantly change the real cost of ownership.',
      });
    }
  }

  // 3. Property type conflict: subtype says "lot/land" but normalized category is co-op (or other mismatch)
  const rawHomeType = snap.homeType ?? snap.home_type ?? '';
  const rawPropertySubtype = (raw as any).rawPropertySubtype ?? (raw as any).propertySubtype ?? '';
  if (normCat === 'co_op') {
    if (/lot|land|vacant/i.test(rawHomeType) || /lot|land|vacant/i.test(rawPropertySubtype)) {
      contradictions.push({
        id: nextId('type-conflict'),
        severity: 'high',
        description: 'Property subtype mentions lot/land, but co-op classification was detected from other signals.',
        field1: `Home type field: "${rawHomeType}"`,
        field2: `Normalized category: ${displayType}`,
        suggestion: 'Verify the actual property type with the listing agent — there may be a data extraction error.',
      });
    }
  }

  // 4. Mother-daughter mention for single-family: may not be legal rental
  if (normCat === 'single_family' || normCat === 'single_family_owner_occupier') {
    if (/mother.daughter|mother-daughter/i.test(description)) {
      contradictions.push({
        id: nextId('mother-daughter-sf'),
        severity: 'medium',
        description: 'Listing mentions a mother-daughter layout, but this is classified as a single-family home.',
        field1: 'Normalized category: Single-family home',
        field2: 'Listing: mentions mother-daughter layout',
        suggestion: 'Mother-daughter layouts may not be legal sleeping space or rental space unless egress, ceiling height, permits, and Certificate of Occupancy support it.',
      });
    }
  }

  // 5. Low price + long days on market + missing cost info
  if (daysOnMarket != null && daysOnMarket > 90 && hoaAmount == null && normCat === 'co_op') {
    contradictions.push({
      id: nextId('low-price-dom'),
      severity: 'medium',
      description: `Property has been on market for ${daysOnMarket} days with no disclosed maintenance fee.`,
      field1: `Days on market: ${daysOnMarket}`,
      field2: 'Monthly maintenance: Not disclosed',
      suggestion: 'A long market time with a low disclosed price but missing maintenance cost may indicate the true cost is much higher than the sticker price.',
    });
  }

  // 6. Verdict-price mismatch: verdict says overpriced but price is within 3% of zestimate
  const verdict = (raw?.overall_verdict ?? raw?.verdict ?? '').toLowerCase();
  if (
    (verdict.includes('overpriced') || verdict.includes('overvalued')) &&
    price > 0 && zestimate > 0 &&
    Math.abs(price - zestimate) / zestimate <= 0.03
  ) {
    contradictions.push({
      id: nextId('verdict-price-mismatch'),
      severity: 'low',
      description: 'Verdict says overpriced, but asking price is within 3% of Zestimate.',
      field1: `Asking price: $${price.toLocaleString()}`,
      field2: `Zestimate: $${zestimate.toLocaleString()}`,
      suggestion: 'Review the price assessment basis — if asking price is close to Zestimate, "overpriced" may be too strong a verdict.',
    });
  }

  return contradictions;
}

// ── Evidence Score 计算 ────────────────────────────────────────────────────────

export type EvidenceVerdict = 'Strong Listing Evidence' | 'Enough to Review' | 'Review With Caution' | 'Need More Evidence' | 'High Uncertainty';

/**
 * computeEvidenceScore — Evidence Score for Basic reports.
 * Represents listing information completeness, NOT property quality.
 * ALWAYS calculated from raw listing data; never trusts AI-supplied scores.
 *
 * Scoring:
 *   base 20
 *   address +10
 *   asking price +10
 *   beds +8
 *   baths +8
 *   sqft +12
 *   property type +8
 *   year built +6
 *   tax/HOA +8
 *   photos count > 0 +8
 *   listing description +5
 *   legal/multi-family confirmed +8
 *   comps/zestimate/market estimate +8
 *   cap 100
 *
 * Max achievable with only address+price+beds+baths = 20+10+10+8+8 = 76.
 * Needs sqft+type+tax+photos+desc+legal+comps to reach 85+.
 */
export function computeEvidenceScore(result: any, listingInfo?: any): number {
  const raw = result?.raw ?? result;

  let score = 20;
  const snap = raw?.property_snapshot ?? {};
  const info = listingInfo ?? {};

  const has = (v: unknown) => v != null && v !== '';

  if (has(snap?.address ?? info?.address)) score += 10;
  if (has(snap?.asking_price ?? info?.price ?? snap?.askingPrice)) score += 10;
  if (has(snap?.beds ?? info?.bedrooms ?? snap?.beds)) score += 8;
  if (has(snap?.baths ?? info?.bathrooms ?? snap?.baths)) score += 8;
  if (has(snap?.sqft ?? info?.sqft ?? snap?.squareFeet)) score += 12;
  if (has(snap?.home_type ?? info?.propertyType)) score += 8;
  if (has(snap?.year_built ?? info?.yearBuilt)) score += 6;
  if (has(snap?.annual_tax ?? info?.taxes ?? info?.tax ?? snap?.hoa ?? info?.hoa)) score += 8;
  if (has(snap?.photos_count ?? info?.photos_count)) score += 8;
  if (has(raw?.quickSummary ?? raw?.quick_summary ?? raw?.summary ?? raw?.bottom_line)) score += 5;
  if (has(raw?.legal_compliance ?? raw?.certificateOfOccupancy ?? snap?.legal_use)) score += 8;
  if (has(snap?.price_per_sqft ?? info?.zestimate ?? snap?.zestimate ?? snap?.market_estimate)) score += 8;

  return Math.min(100, score);
}

export function evidenceVerdict(score: number): EvidenceVerdict {
  // Must match backend getBasicVerdict() in analyze/index.ts exactly:
  // score >= 80 -> Enough to Review
  // score >= 60 -> Review With Caution
  // score >= 40 -> Need More Evidence
  // score < 40  -> High Uncertainty
  if (score >= 80) return 'Enough to Review';
  if (score >= 60) return 'Review With Caution';
  if (score >= 40) return 'Need More Evidence';
  return 'High Uncertainty';
}

// ── 校验函数 ──────────────────────────────────────────────────────────────────

/**
 * 问句校验：必须是完整问句，不接受陈述句、字段名、风险总结.
 * 规则：结尾是 ?，或以 can/is/are/what/when/how/has/does/do/why 开头，长度 >= 10.
 */
export function isValidQuestion(text: string): boolean {
  if (!text || text.trim().length < 10) return false;
  const q = text.trim();
  if (q.endsWith('?')) return true;
  return /^(can|is|are|what|when|how|has|does|do|why|should|would|could|will|have)/i.test(q);
}

/**
 * Action 校验：长度 >= 50, 必须以 Ask/Check/Verify/Request/Inspect/Obtain/Get 开头,
 * 且不能等于 summary.
 */
export function isValidAction(action: string, summary: string): boolean {
  if (!action || action.trim().length < 50) return false;
  if (action.trim() === (summary || '').trim()) return false;
  return /^(ask|check|verify|request|inspect|obtain|get)/i.test(action.trim());
}

// ── 照片一致性校验 ────────────────────────────────────────────────────────────
// INTERIOR_AREAS lives in interiorPhotos.ts so both usRent.ts and this viewModel
// share one definition. Re-import here for any local readers that want the array
// directly.

function spaceTypeLabel(s: string): string {
  const map: Record<string, string> = {
    kitchen: 'Kitchen', bathroom: 'Bathroom', bedroom: 'Bedroom',
    living_room: 'Living Room', livingroom: 'Living Room', exterior: 'Exterior',
    garage: 'Garage', basement: 'Basement', pool: 'Pool', yard: 'Yard',
    dining_room: 'Dining Room', office: 'Office', hallway: 'Hallway',
    laundry: 'Laundry', storage: 'Basement / Storage', attic: 'Attic',
  };
  const n = s?.toLowerCase() ?? '';
  return map[n] ?? s;
}

export function normalizeEnhancedPhotoAnalysis(raw: any, imageUrls: string[] = []): PhotoAnalysisEnhancedVM {
  const photo_analysis = raw?.photo_analysis ?? {};
  const step1_areas = raw?.areas ?? [];
  const topConcerns = raw?.topVisualConcerns ?? raw?.topVisibleConcerns ?? photo_analysis?.keyConcerns ?? [];
  const importantMissingViews = raw?.importantMissingViews ?? photo_analysis?.missingViews ?? [];
  const inspectionPriorities = raw?.inspectionPrioritiesFromPhotos ?? photo_analysis?.inspectionPriorities ?? [];
  const hasVirtualStaging = raw?.stagingSignals?.hasVirtualStaging === true
    || photo_analysis?.hasVirtualStaging === true;
  const overallTakeaway = photo_analysis?.overallTakeaway ?? '';

  const totalPhotos = raw?.totalPhotos ?? photo_analysis?.totalPhotosAnalyzed
    ?? imageUrls.length ?? 0;

  const detectedAreas = Array.isArray(raw?.areasDetected)
    ? raw.areasDetected
    : Array.isArray(raw?.detectedAreas) ? raw.detectedAreas : [];

  const rawAreas = Array.isArray(step1_areas) ? step1_areas : [];

  const normalizedAreas: PhotoAnalysisAreaVM[] = rawAreas.map((a: any) => ({
    area: spaceTypeLabel(a.area ?? a.spaceType ?? ''),
    score: a.conditionScore ?? a.score ?? 0,
    confidence: a.confidence ?? 'Medium',
    visualConcerns: (a.visualConcerns ?? a.concerns ?? []).slice(0, 3),
    missingEvidence: (a.missingEvidence ?? a.missingViews ?? []).slice(0, 3),
    inspectionQuestions: (a.inspectionQuestions ?? []).slice(0, 3),
    buyerTakeaway: a.buyerTakeaway ?? '',
    photoCount: a.photoCount ?? 0,
  }));

  const normAreas = normalizedAreas.map(a => a.area.toLowerCase());
  const hasInterior = normAreas.some(a => INTERIOR_AREAS_LIST.some(i => a.includes(i)));
  const coverageNote = hasInterior
    ? (totalPhotos > 10 ? 'reasonable' : 'limited')
    : 'missing';

  return {
    totalPhotos,
    detectedAreas,
    topConcerns: topConcerns.slice(0, 3),
    importantMissingViews: importantMissingViews.slice(0, 5),
    inspectionPriorities: inspectionPriorities.slice(0, 4),
    hasVirtualStaging,
    overallTakeaway,
    areas: normalizedAreas,
    coverageNote,
  };
}

export interface PhotoAnalysisVM {
  detectedAreas: string[];
  hasInteriorPhotos: boolean;
  photoCount: number;
  summary: string;
  coverageNote: 'missing' | 'limited' | 'reasonable';
  // ── Enhanced fields (from Step1 + Step2 photo_analysis) ──
  topConcerns?: string[];
  importantMissingViews?: string[];
  inspectionPriorities?: string[];
  hasVirtualStaging?: boolean;
  overallTakeaway?: string;
}

export interface PhotoAnalysisAreaVM {
  area: string;
  score: number;
  confidence: string;
  visualConcerns: string[];
  missingEvidence: string[];
  inspectionQuestions: string[];
  buyerTakeaway: string;
  photoCount: number;
}

export interface PhotoAnalysisEnhancedVM {
  totalPhotos: number;
  detectedAreas: string[];
  topConcerns: string[];
  importantMissingViews: string[];
  inspectionPriorities: string[];
  hasVirtualStaging: boolean;
  overallTakeaway: string;
  areas: PhotoAnalysisAreaVM[];
  coverageNote: 'missing' | 'limited' | 'reasonable';
}

export function normalizePhotoAnalysis(raw: any, imageUrls: string[] = []): PhotoAnalysisVM {
  const rawAreas: string[] = (raw?.detectedAreas ?? raw?.areas ?? []).map(String);
  const normalized = rawAreas.map(a => a.toLowerCase());
  // Cross-check the three sources via the shared helper. This keeps the
  // viewModel consistent with usRent.ts so the report never renders the
  // visual analysis cards AND the "No interior photos" fallback at the
  // same time.
  const hasInterior = hasInteriorPhotosShared({
    step1Areas: raw?.areas,
    step1DetectedAreas: raw?.detectedAreas,
    photoReview: raw?.photoReview,
    visualAnalysis: raw?.visualAnalysis,
    photoHabitabilityReview: raw?.photo_habitability_review,
    imageUrls,
  }) || normalized.some(a =>
    INTERIOR_AREAS_LIST.some(i => a.includes(i))
  );
  const photoCount = imageUrls.length || rawAreas.length || 0;

  let coverageNote: PhotoAnalysisVM['coverageNote'];
  let summary: string;

  if (hasInterior) {
    coverageNote = photoCount > 10 ? 'reasonable' : 'limited';
    summary = photoCount > 10
      ? MODULE_FALLBACKS.PHOTO_COVERAGE_REASONABLE
      : MODULE_FALLBACKS.PHOTO_LIMITED_CONDITION;
  } else {
    coverageNote = 'missing';
    summary = MODULE_FALLBACKS.PHOTO_MISSING_INTERIOR;
  }

  // Pull enhanced fields from Step1/Step2 photo_analysis
  const photo_analysis = raw?.photo_analysis ?? {};
  const topConcerns = raw?.topVisualConcerns ?? raw?.topVisibleConcerns ?? photo_analysis?.keyConcerns ?? undefined;
  const importantMissingViews = raw?.importantMissingViews ?? photo_analysis?.missingViews ?? undefined;
  const inspectionPriorities = raw?.inspectionPrioritiesFromPhotos ?? photo_analysis?.inspectionPriorities ?? undefined;
  const hasVirtualStaging = raw?.stagingSignals?.hasVirtualStaging === true
    || photo_analysis?.hasVirtualStaging === true ? true : undefined;
  const overallTakeaway = photo_analysis?.overallTakeaway ?? undefined;

  return {
    detectedAreas: rawAreas,
    hasInteriorPhotos: hasInterior,
    photoCount,
    summary,
    coverageNote,
    ...(topConcerns !== undefined && { topConcerns }),
    ...(importantMissingViews !== undefined && { importantMissingViews }),
    ...(inspectionPriorities !== undefined && { inspectionPriorities }),
    ...(hasVirtualStaging !== undefined && { hasVirtualStaging }),
    ...(overallTakeaway !== undefined && { overallTakeaway }),
  };
}

// ── Price 一致性校验 ──────────────────────────────────────────────────────────

export type PriceVerdict = 'Unknown' | 'Needs Comps' | 'Overpriced' | 'Fair' | 'Good Value';
export type PriceConfidence = 'Low' | 'Medium' | 'High';

export interface PriceVM {
  askingPrice: string | null;
  estimatedMin: string | null;
  estimatedMax: string | null;
  verdict: PriceVerdict;
  confidence: PriceConfidence;
  analysis: string;
  warning?: string;
}

export function normalizePriceVerdict(v: string | undefined, explanation?: string): PriceVerdict {
  const raw = [v, explanation].filter(Boolean).join(' ').trim();
  if (!raw) return 'Unknown';
  const lower = raw.toLowerCase();

  if (/overpriced|overvalued|too high|priced high|appears high|looks high|high for/i.test(lower)) {
    return 'Overpriced';
  }
  if (/underpriced|bargain|good.value|attractive|below market|priced low/i.test(lower)) {
    return 'Good Value';
  }
  if (/fair|reasonable|appropriate|in line with market/i.test(lower)) {
    return 'Fair';
  }
  if (/without comps|needs comps|need comps|verify with comps|comps needed|cannot be judged confidently|insufficient data|limited confidence|low confidence/i.test(lower)) {
    return 'Needs Comps';
  }
  if (/price.*high|asking price.*high|expensive/i.test(lower)) {
    return 'Overpriced';
  }
  return 'Unknown';
}

function conflictingVerdict(text: string, verdict: PriceVerdict): boolean {
  const lower = text.toLowerCase();
  if (verdict === 'Overpriced') return /appears fair|good value|bargain|underpriced/i.test(lower);
  if (verdict === 'Fair') return /overpriced|overvalued/i.test(lower);
  return false;
}

export function normalizePriceCopy(priceAssessment: any): PriceVM {
  const explanation = priceAssessment?.explanation;
  const verdict = normalizePriceVerdict(priceAssessment?.verdict ?? priceAssessment?.valuation_verdict, explanation);

  let confidence: PriceConfidence = 'Medium';
  const confRaw = priceAssessment?.valuationConfidence ?? priceAssessment?.valuation_confidence
    ?? priceAssessment?.confidence;
  if (confRaw) {
    const c = String(confRaw).toLowerCase();
    if (/high|strong/i.test(c)) confidence = 'High';
    else if (/low|weak/i.test(c)) confidence = 'Low';
  }

  let analysis: string;
  switch (verdict) {
    case 'Unknown':
      analysis = MODULE_FALLBACKS.PRICE_ANALYSIS_UNKNOWN;
      break;
    case 'Needs Comps':
      analysis = priceAssessment?.explanation || 'Price looks directionally clear, but comparable sales are still needed to verify the verdict confidently.';
      break;
    case 'Overpriced':
      if (priceAssessment?.explanation && !conflictingVerdict(priceAssessment.explanation, verdict)) {
        analysis = priceAssessment.explanation;
      } else {
        analysis = MODULE_FALLBACKS.PRICE_ANALYSIS_OVERPRICED;
      }
      break;
    case 'Fair':
      analysis = priceAssessment?.explanation || MODULE_FALLBACKS.PRICE_ANALYSIS_FAIR;
      break;
    case 'Good Value':
      analysis = priceAssessment?.explanation || MODULE_FALLBACKS.PRICE_ANALYSIS_GOOD_VALUE;
      break;
  }

  return {
    askingPrice: fmtMoney(priceAssessment?.asking_price ?? priceAssessment?.askingPrice ?? priceAssessment?.listPrice),
    estimatedMin: fmtMoney(priceAssessment?.estimated_min ?? priceAssessment?.estimatedMin),
    estimatedMax: fmtMoney(priceAssessment?.estimated_max ?? priceAssessment?.estimatedMax),
    verdict,
    confidence,
    analysis,
  };
}

// ── Carrying Costs 清理 ───────────────────────────────────────────────────────

export interface CarryingCostItem { label: string; value: string; }

export interface CarryingCostVM {
  hasBreakdown: boolean;
  estimatedMonthly: string | null;
  items: CarryingCostItem[];
  warning: string;
}

export function normalizeCarryingCosts(costs: any): CarryingCostVM {
  const items: CarryingCostItem[] = [];

  const fields: Array<{ label: string; value: any }> = [
    { label: 'Known Tax', value: costs?.annualTax ?? costs?.annual_tax },
    { label: 'HOA', value: costs?.hoa ?? costs?.HOA ?? costs?.monthly_hoa },
    { label: 'Insurance Est.', value: costs?.insuranceEstimate ?? costs?.insurance ?? costs?.insurance_estimate },
    { label: 'Maintenance Reserve', value: costs?.maintenanceReserve ?? costs?.maintenance_reserve },
    { label: 'Financing Assumptions', value: costs?.financingAssumptions ?? costs?.financing_assumptions },
  ];

  for (const f of fields) {
    if (f.value != null && f.value !== '') {
      const text = typeof f.value === 'number' ? fmtMoney(f.value) : toText(f.value);
      if (text) items.push({ label: f.label, value: text });
    }
  }

  const estimatedMonthly = costs?.estimatedMonthlyCost ?? costs?.estimated_monthly_cost
    ?? costs?.monthlyCost ?? costs?.monthly_cost ?? null;

  const hasBreakdown = items.length > 0;

  return {
    hasBreakdown,
    estimatedMonthly: estimatedMonthly != null && estimatedMonthly !== ''
      ? (typeof estimatedMonthly === 'number' ? fmtMoney(estimatedMonthly) : toText(estimatedMonthly))
      : null,
    items,
    warning: MODULE_FALLBACKS.CARRYING_COSTS_WARNING,
  };
}

// ── Deal-Changing Risks ────────────────────────────────────────────────────────

export interface DealRiskVM {
  id: string;
  category: string;
  severity: 'High' | 'Medium' | 'Low';
  summary: string;
  action: string;
}

function normalizeSeverity(level: any): DealRiskVM['severity'] {
  const s = String(level ?? '').toLowerCase();
  if (/high|critical|severe/i.test(s)) return 'High';
  if (/low/i.test(s)) return 'Low';
  return 'Medium';
}

export function normalizeDealRisks(risks: any[], context: { isNYC?: boolean; reportProfile?: string } = {}): DealRiskVM[] {
  const { isNYC = false, reportProfile } = context;
  const isSFOC = reportProfile === 'single_family_owner_occupier';

  const OVERRIDE_ACTIONS: Record<string, string> = {
    maintenance: RISK_ACTION_FALLBACKS.maintenance,
    legal: isSFOC
      ? (isNYC ? RISK_ACTION_FALLBACKS.legal_sfoc_nyc : RISK_ACTION_FALLBACKS.legal_sfoc_general)
      : (isNYC ? RISK_ACTION_FALLBACKS.legal_nyc : RISK_ACTION_FALLBACKS.legal_general),
    environmental: isNYC ? RISK_ACTION_FALLBACKS.environmental_nyc : RISK_ACTION_FALLBACKS.environmental_general,
    price: RISK_ACTION_FALLBACKS.price,
    market: RISK_ACTION_FALLBACKS.market,
  };

  return risks.map((risk, idx) => {
    const category = toText(risk.category ?? risk.type ?? risk.area ?? 'default').toLowerCase();
    const severity = normalizeSeverity(risk.severity ?? risk.riskLevel ?? risk.level);
    const summary = toText(risk.summary ?? risk.description ?? risk.title ?? risk.signal ?? '');

    let action = toText(risk.action ?? risk.recommendation ?? risk.what_to_do ?? risk.next_step ?? '');
    if (!isValidAction(action, summary)) {
      const catKey = Object.keys(OVERRIDE_ACTIONS).find(k => category.includes(k)) ?? 'default';
      action = OVERRIDE_ACTIONS[catKey];
    }

    return {
      id: `risk-${idx}`,
      category,
      severity,
      summary,
      action,
    };
  });
}

// ── What Could Change Your Decision ───────────────────────────────────────────

export interface DecisionCardVM {
  id: string;
  title: string;
  explanation: string;
  badge: string;
}

const CARD_TITLE_MAP: Record<string, string> = {
  market_time: 'Long Market Time',
  fast_moving: 'Fast-Moving Listing Risk',
  basement: 'Basement Moisture Risk',
  basement_permit_egress: 'Basement Permit / Egress Risk',
  renovation: 'Renovation Cost Risk',
  legal: 'Rental Legality Risk',
  price: 'Price Confidence Risk',
  roof: 'Roof Condition Risk',
  inspection: 'Inspection Findings',
  price_verify: 'Price Confidence Risk',
  legal_verify: 'Legal Verification Needed',
  default: 'Key Verification Risk',
};

export function normalizeDecisionCards(
  reasons: any[],
  risks: any[],
  photoVM: PhotoAnalysisVM,
): DecisionCardVM[] {
  const CARDS: DecisionCardVM[] = [];
  const added = new Set<string>();

  const textSources = [...(reasons || []), ...(risks || [])]
    .map((r) => toText(typeof r === 'string' ? r : (r?.signal ?? r?.text ?? r?.title ?? '')))
    .filter(Boolean);

  const FAMILY_KEYWORDS: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /long market time|listed.*ago.*\d{3,} days|hasn't sold|hasnt sold.*\d{3,}/i, category: 'market_time' },
    { pattern: /only \d+ days|fast.moving|short market|buyer pressure|\b\d+ days on market\b.*competitive|\b5 days\b.*market/i, category: 'fast_moving' },
    { pattern: /basement.*(egress|ceiling height|permit|permitted|unpermitted|legal use|occupancy)|(?:egress|ceiling height|permit|permitted|unpermitted|legal use|occupancy).*basement/i, category: 'basement_permit_egress' },
    { pattern: /basement|moisture|water.*intrusion|drainage|foundation/i, category: 'basement' },
    { pattern: /kitchen|bathroom|renovation|\$\d+.*k|update|cosmetic/i, category: 'renovation' },
    { pattern: /legal|co|certificate|rental|two.family|occupancy/i, category: 'legal' },
    { pattern: /price|comparable|valuation|overpriced/i, category: 'price' },
    { pattern: /roof/i, category: 'roof' },
  ];

  for (const text of textSources) {
    if (CARDS.length >= 3) break;

    // 如果有室内照片，跳过 photo 相关的卡片
    if (photoVM.hasInteriorPhotos && /photo|interior|missing/i.test(text)) continue;

    let category = 'default';
    for (const { pattern, category: cat } of FAMILY_KEYWORDS) {
      if (pattern.test(text)) { category = cat; break; }
    }

    const title = CARD_TITLE_MAP[category];
    if (!added.has(title)) {
      added.add(title);
      CARDS.push({ id: category, title, explanation: text, badge: 'Verify' });
    }
  }

  const fallbacks: DecisionCardVM[] = [
    { id: 'fast_moving', title: 'Fast-Moving Listing Risk', explanation: 'A short time on market may create buyer pressure. Do not skip inspection, permit checks, or roof/system due diligence just to move quickly.', badge: 'Verify' },
    { id: 'inspection', title: 'Inspection Findings', explanation: 'Full inspection is needed to verify structural integrity, systems condition, and any hidden issues.', badge: 'Verify' },
    { id: 'price_verify', title: 'Price Confidence Risk', explanation: 'Comparable sales and market conditions should be verified with local data.', badge: 'Verify' },
    { id: 'legal_verify', title: 'Legal Verification Needed', explanation: 'Property records, permits, and any outstanding violations should be confirmed before making an offer.', badge: 'Verify' },
  ];

  for (const f of fallbacks) {
    if (CARDS.length >= 3) break;
    if (!added.has(f.title)) {
      added.add(f.title);
      CARDS.push(f);
    }
  }

  return CARDS.slice(0, 3);
}

// ── Agent Spin Decoder ─────────────────────────────────────────────────────────

export interface SpinDecoderVM {
  listingSays: string;
  homeScopeReads: string;
  ask: string;
}

export function normalizeSpinDecoder(items: any[], context: { isNYC?: boolean; reportProfile?: string } = {}): SpinDecoderVM[] {
  const { reportProfile } = context;
  const isSFOC = reportProfile === 'single_family_owner_occupier';

  return items.map(item => {
    const listingSays = toText(item.phrase ?? item.listing_says ?? item.listing ?? item.keyword ?? '');
    const homeScopeReads = toText(item.what_it_may_mean ?? item.interpretation ?? item.reads ?? '');
    let ask = toText(item.what_to_verify ?? item.ask ?? item.question ?? item.ask_before_viewing ?? '');

    const askLower = ask.toLowerCase();
    const listingLower = listingSays.toLowerCase();

    // ── SFOC: override to match claim topic ───────────────────────────────────────
    // SFOC: boiler / water heater updates → ask about permits and installation records
    if (isSFOC && /boiler|navien|tankless|water heater|hot water/i.test(listingLower)) {
      if (!/permit|installation|when|installed|warrant/i.test(askLower)) {
        ask = 'When was the boiler and water heater installed, were permits pulled, and are warranties transferable?';
      }
    }
    // SFOC: updated / renovated kitchen or bathroom → ask about permits
    if (isSFOC && /updated.*kitchen|updated.*bath|new.*kitchen|new.*bath|renovated.*kitchen|renovated.*bath/i.test(listingLower)) {
      if (!/permit|when|installed|what.*updated/i.test(askLower)) {
        ask = 'What was updated, when, were permits pulled, and who performed the work?';
      }
    }
    // SFOC: transit / commute / near → ask about actual commute time
    if (isSFOC && /commute|close to|near|transit|minute|commut/i.test(listingLower)) {
      if (!/actual|commute|what is|how long|travel/i.test(askLower)) {
        ask = 'What is the actual commute time, noise level, and parking situation?';
      }
    }
    // SFOC: updated / renovated (general) → ask about permits and what was updated
    if (isSFOC && /updated|renovated/i.test(listingLower)) {
      if (!/permit|when|what.*updated|updated.*when/i.test(askLower)) {
        ask = 'What was updated, when, were permits pulled, and who performed the work?';
      }
    }
    // SFOC: basement / driveway / yard (not rental signal) → ask about moisture/drainage
    if (isSFOC && /basement|driveway|yard|private.*drive|parking/i.test(listingLower)) {
      if (!/water|moisture|foundation|drainage|intrusion|flood/i.test(askLower) && /basement/i.test(listingLower)) {
        ask = 'Has the basement had water intrusion, foundation repairs, or drainage issues?';
      }
    }
    // SFOC: legal two-family / multi-family mention → keep it simple for SFOC (shouldn't appear for SFOC, but safe fallback)
    if (isSFOC && /two.family|multi.family|rental unit|income unit|legal.*two/i.test(listingLower)) {
      ask = 'Can you confirm the legal use and provide the Certificate of Occupancy?';
    }

    // ── Generic: keyword domain overrides (applies to all properties) ──────────────
    // rent / income / investor / live in one → ask about legal rent confirmation
    if (/rent|unit|income|investor|live in one/i.test(listingLower)) {
      if (!/legal|actual rent|co|certificate|occupancy|rent roll/i.test(askLower)) {
        ask = 'Can you confirm the legal rental status, provide actual rent amounts, and show the Certificate of Occupancy before viewing?';
      }
    }
    // basement / recreation / storage → ask about water/foundation/drainage
    if (/basement|recreation|storage/i.test(listingLower)) {
      if (!/water|moisture|foundation|drainage|flood|intrus/i.test(askLower)) {
        ask = 'Has the basement had water intrusion, foundation repairs, or drainage issues?';
      }
    }
    // spacious / two-family → ask about legal area / CO
    if (/spacious|two.family|multi.family/i.test(listingLower)) {
      if (!/legal|unit|square footage|co|certificate/i.test(askLower)) {
        ask = 'Can you confirm the legal number of units, total square footage, and provide the Certificate of Occupancy?';
      }
    }
    // parking claims → keep practical, but push on legal/physical constraints
    if (/on.?site parking|parking|garage|driveway|private drive/i.test(listingLower)) {
      if (!/garage|curb|easement|deeded|restricted|condition/i.test(askLower)) {
        ask = 'On-site parking is useful, but confirm garage condition, curb-cut legality, easements, and whether parking is separately deeded or restricted.';
      }
    }
    // separate utilities / meter claims → surface owner-paid heat risk
    if (/separate utilities|separate gas|separate electric|two gas meters|two electric meters|one heating system/i.test(listingLower)) {
      if (!/heat|owner|utility|meter|billing/i.test(askLower)) {
        ask = 'Separate gas/electric meters help, but one heating system may mean the owner still pays heat. Confirm billing setup and landlord-paid utilities.';
      }
    }

    // ── Semantic mismatch guard: if claim topic exists but question is completely off-topic, override ─
    // Only override when ask is non-empty (don't override empty strings that the above rules would fill)
    if (ask) {
      // Transit/commute claim → should not answer about parking/commute in unrelated context
      if (/commute|transit|near|close|minute|commut/i.test(listingLower)) {
        if (!/commute|actual.*commute|travel|noise|parking|transit/i.test(askLower) && askLower.length > 0) {
          // If ask is about something completely unrelated (e.g., boiler permits when claim is about commute)
          // then override
          if (/boiler|permit|kitchen|bath|roof|electrical/i.test(askLower)) {
            ask = 'What is the actual commute time, noise level, and parking situation?';
          }
        }
      }
    }

    return { listingSays, homeScopeReads, ask };
  });
}

// ── Who This Works For ─────────────────────────────────────────────────────────

export interface FitVM {
  bestFor: string[];
  notIdealFor: string[];
  whyItMatters: string;
}

export function normalizeFitSection(layoutFit: any): FitVM {
  const bestFor: string[] = [];
  const notIdealFor: string[] = [];

  const bfRaw = layoutFit?.best_for ?? layoutFit?.bestFor ?? layoutFit?.good_for ?? [];
  const bfArr = Array.isArray(bfRaw) ? bfRaw : [bfRaw];
  for (const item of bfArr) {
    const text = toText(item);
    if (text && text.length > 5) bestFor.push(text);
  }

  const nifRaw = layoutFit?.not_ideal_for ?? layoutFit?.notIdealFor ?? [];
  const nifArr = Array.isArray(nifRaw) ? nifRaw : [nifRaw];
  for (const item of nifArr) {
    const text = toText(item);
    if (text && text.length > 5) notIdealFor.push(text);
  }

  return {
    bestFor: bestFor.length ? bestFor : [MODULE_FALLBACKS.FIT_BEST_FOR_DEFAULT],
    notIdealFor: notIdealFor.length ? notIdealFor : [MODULE_FALLBACKS.FIT_NOT_IDEAL_DEFAULT],
    whyItMatters: toText(layoutFit?.why_it_matters ?? layoutFit?.why ?? ''),
  };
}

// ── Questions to Ask ──────────────────────────────────────────────────────────

export interface QuestionVM {
  text: string;
  category: string;
  tagColor: string;
}

/**
 * 字段兼容映射：从 raw 中读取所有可能的 questions 字段。
 * 不返回任何 fallback，只透传 AI 返回的真实数据。
 * 数组元素可能是 string 或 object。
 */
function getRawQuestions(raw: any): any[] {
  const rawArr =
    raw?.questions_to_ask ??
    raw?.questionsToAsk ??
    raw?.agentQuestions ??
    raw?.agent_questions ??
    [];
  return Array.isArray(rawArr) ? rawArr : [];
}

/**
 * 从 result 中提取 what_we_know 和 whats_missing，识别已知字段和缺失维度 */
function extractQuestionContext(result: any): {
  hasPrice: boolean;
  hasBeds: boolean;
  hasBaths: boolean;
  hasSqft: boolean;
  hasPropertyType: boolean;
  hasCondition: boolean;
  hasLegalUse: boolean;
  hasCosts: boolean;
  hasComps: boolean;
  hasZillowMonthly: boolean;
  isUS: boolean;
  isAU: boolean;
  sourceDomain: string;
  reportProfile: string;
  normalizedPropertyCategory: string;
} {
  const wwKnow = result?.what_we_know ?? result?.whatWeKnow ?? {};
  const raw = result?.raw ?? result;

  // Also check listingInfo and property_snapshot for basic fields —
  // Full Analysis may not populate what_we_know but the listing data is present.
  const listingInfo = raw?.listingInfo ?? raw?.listing_info ?? {};
  const propSnap = raw?.property_snapshot ?? {};

  const has = (v: unknown) => v != null && v !== '';

  const sourceDomain = raw?.sourceDomain ?? raw?.source_domain ?? '';
  const isAU = /realestate|domain|allhomes/i.test(sourceDomain);
  const isUS = !isAU;

  return {
    hasPrice:        has(wwKnow?.asking_price ?? wwKnow?.askingPrice ?? wwKnow?.price),
    // Check both what_we_know AND listing data sources
    hasBeds:         has(wwKnow?.beds ?? wwKnow?.bedrooms)
                       || has(listingInfo?.bedrooms ?? listingInfo?.beds)
                       || has(propSnap?.beds ?? propSnap?.bedrooms),
    hasBaths:        has(wwKnow?.baths ?? wwKnow?.bathrooms)
                       || has(listingInfo?.bathrooms ?? listingInfo?.baths)
                       || has(propSnap?.baths ?? propSnap?.bathrooms),
    hasSqft:         has(wwKnow?.sqft ?? wwKnow?.square_feet ?? wwKnow?.squareFeet ?? wwKnow?.floor_area)
                       || has(listingInfo?.sqft ?? listingInfo?.floorArea ?? listingInfo?.floor_area)
                       || has(propSnap?.sqft ?? propSnap?.sqft ?? propSnap?.floor_area),
    hasPropertyType: has(wwKnow?.property_type ?? wwKnow?.propertyType ?? wwKnow?.home_type ?? wwKnow?.homeType)
                       || has(listingInfo?.propertyType ?? listingInfo?.property_type ?? listingInfo?.homeType)
                       || has(propSnap?.homeType ?? propSnap?.home_type ?? propSnap?.propertyType ?? propSnap?.property_type),
    hasCondition:    !!(raw?.spaceAnalysis || raw?.visualAnalysis || raw?.photos || raw?.space_analysis),
    // Legal use is considered missing if whats_missing mentions it (so !hasLegalUse triggers a question)
    // If nothing legal is mentioned in missing, we still don't have confirmed CO — ask anyway
    hasLegalUse:    false, // Always ask for legal docs unless we have an explicit CO confirmation
    // hasCosts: true if we have tax/insurance/HOA from what_we_know OR monthly_cost_snapshot from Zillow
    hasCosts:        !!(raw?.monthly_cost_snapshot?.estimated_monthly_payment) ||
                       has(wwKnow?.taxes ?? wwKnow?.annual_tax ?? wwKnow?.insurance ?? wwKnow?.hoa),
    hasComps:        has(wwKnow?.comparable_sales ?? wwKnow?.comparableSales ?? wwKnow?.zestimate),
    hasZillowMonthly: !!(raw?.monthly_cost_snapshot?.estimated_monthly_payment),
    isUS,
    isAU,
    sourceDomain,
    reportProfile: raw?.meta?.reportProfile ?? raw?.reportProfile ?? 'unknown',
    normalizedPropertyCategory: raw?.normalizedPropertyCategory ?? raw?.reportProfile ?? 'unknown',
  };
}

export function normalizeQuestions(
  questions: any[],
  context: {
    isNYC?: boolean;
    maxQuestions?: number;
    fallbackQuestions?: string[];
    /** 传入原始 result，用于动态 fallback 生成 */
    result?: any;
  } = {},
): QuestionVM[] {
  console.log('[TRACE_Q_INPUT]', questions);

  const { maxQuestions = 6, result: rawResult } = context;
  const results: QuestionVM[] = [];
  const seen = new Set<string>();
  const seenSemanticKeys = new Set<string>();

  // Photos tag: only match explicit photo/image keywords, NOT "interior"
  const TAG_MAP: Array<{ pattern: RegExp; label: string; color: string }> = [
    { pattern: /legal|co |occupancy|permit|violation|registered/i, label: 'Legal', color: 'bg-violet-100 text-violet-700' },
    { pattern: /roof|drainage|leak/i, label: 'Roof', color: 'bg-amber-100 text-amber-700' },
    { pattern: /electrical|plumb|heating|boiler|system|mechanical|plumbing/i, label: 'Systems', color: 'bg-orange-100 text-orange-700' },
    { pattern: /basement|foundation|water|intrusion|drainage/i, label: 'Basement', color: 'bg-blue-100 text-blue-700' },
    { pattern: /rental|rent|income|lease|tenant|legal rent/i, label: 'Rent', color: 'bg-green-100 text-green-700' },
    { pattern: /flood|insurance|zone|windstorm|hurricane/i, label: 'Insurance', color: 'bg-blue-100 text-blue-700' },
    // Photos: only explicit photo/image keywords — NOT "interior" (which causes false matches on "interior square footage")
    { pattern: /\bphotos?\b|photo |photo-|interior photo|exterior photo|\bimages?\b|\bpictures?\b|\bvisuals?\b/i, label: 'Photos', color: 'bg-pink-100 text-pink-700' },
    { pattern: /monthly|cost|tax|hoa|maintenance|reserve|expense|utility/i, label: 'Costs', color: 'bg-teal-100 text-teal-700' },
    { pattern: /comparable|comp|sale|market.*value|price.*verdict/i, label: 'Price', color: 'bg-amber-100 text-amber-700' },
    { pattern: /days on market|market time|listed|262|hasn't sold/i, label: 'Market Time', color: 'bg-indigo-100 text-indigo-700' },
  ];

  const CORE_QUESTION_FAMILIES: Array<{ keywords: RegExp }> = [
    { keywords: /certificate of occupancy|legal two.?family|legal use|legal status/i },
    { keywords: /violations.*hpd|open permits.*violations|open permits.*hpd/i },
    { keywords: /violation|complaint|permit|open permit|dob|hpd/i },
    { keywords: /roof|drainage|leak/i },
    { keywords: /electrical|plumb|heating|boiler|system|mechanical|plumbing/i },
    { keywords: /basement|foundation|water|intrusion|drainage/i },
    { keywords: /rental|rent|income|lease|tenant|legal rent/i },
    { keywords: /flood|insurance|zone|windstorm|hurricane/i },
    { keywords: /monthly|cost|tax|hoa|maintenance|reserve|expense|utility/i },
    { keywords: /comparable|comp|sale|market.*value|price.*verdict/i },
    { keywords: /days on market|market time|listed|262|hasn't sold/i },
  ];

  const FALLBACKS = context?.fallbackQuestions ?? QUESTION_FALLBACKS;

  function getQuestionSemanticKey(text: string): string | null {
    const normalized = text
      .toLowerCase()
      .replace(/ecb\s*\/\s*oath/g, 'ecb oath')
      .replace(/\bcertificate\s+of\s+occupancy\b/g, 'certificate occupancy')
      .replace(/\bco\b/g, 'certificate occupancy')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (/certificate occupancy|legal use|legal status|legal two family/.test(normalized)) {
      return 'legal_co';
    }

    const hasBuildingRecordsSignal = /dob|hpd|ecb|oath|building department/.test(normalized);
    const hasViolationSignal = /violation|violations|permit|permits|complaint|complaints|issue|issues|record|records/.test(normalized);
    if (hasBuildingRecordsSignal || hasViolationSignal) {
      return 'legal_violations';
    }

    if (/comparable|comparables|comp\b|comps\b|active listings|asking price/.test(normalized)) {
      return 'price_comps';
    }

    if (/rent roll|lease|leases|security deposit|security deposits|vacancy|vacant|tenant/.test(normalized)) {
      return 'rent_docs';
    }

    if (/insurance quote|average utility|utility costs|owner paid expenses|listed taxes|hoa/.test(normalized)) {
      return 'costs_actuals';
    }

    return null;
  }

  function getTag(text: string): { label: string; color: string } {
    for (const { pattern, label, color } of TAG_MAP) {
      if (pattern.test(text)) return { label, color };
    }
    return { label: 'General', color: 'bg-slate-100 text-slate-700' };
  }

  const basicFieldContext = rawResult ? extractQuestionContext(rawResult) : null;
  const allBasicFieldsKnown = basicFieldContext
    ? (basicFieldContext.hasBeds && basicFieldContext.hasBaths && basicFieldContext.hasSqft && basicFieldContext.hasPropertyType)
    : false;
  const effectiveCategory = basicFieldContext?.normalizedPropertyCategory ?? basicFieldContext?.reportProfile ?? 'unknown';
  const singleFamilyTypeText = String(
    rawResult?.displayType
      ?? rawResult?.property_snapshot?.homeType
      ?? rawResult?.property_snapshot?.home_type
      ?? '',
  );
  const isSingleFamilyForQuestions =
    effectiveCategory === 'single_family_owner_occupier' ||
    effectiveCategory === 'single_family' ||
    /single.family/i.test(singleFamilyTypeText);
  const suppressPatterns = QUESTIONS_TO_SUPPRESS_BY_CATEGORY[effectiveCategory];

  function shouldDropSFOCQuestion(text: string): boolean {
    if (!isSingleFamilyForQuestions) return false;
    return /legal two.family|second unit rent|actual rent|rental income|rent roll|income unit|two-family opportunity/i.test(text);
  }

  function isSuppressed(text: string): boolean {
    if (!suppressPatterns) return false;
    const lower = text.toLowerCase();
    for (const pattern of suppressPatterns) {
      if (pattern.test(lower)) return true;
    }
    return false;
  }

  function addQuestion(text: string) {
    if (!text || text.length < 10 || seen.has(text)) return;
    if (!isValidQuestion(text)) return;
    if (shouldDropSFOCQuestion(text)) return;
    const semanticKey = getQuestionSemanticKey(text);
    if (semanticKey && seenSemanticKeys.has(semanticKey)) return;
    // P0 filter: skip "missing basic property details" style questions when all 4 basic fields are known.
    // This catches AI-generated questions that slip through the backend normalization.
    if (allBasicFieldsKnown) {
      const lower = text.toLowerCase();
      if (/missing basic property|provide.*beds.*baths.*interior|property type.*beds.*baths.*interior|what are the.*beds.*baths.*size|can you provide.*beds.*baths|missing property details|basic property details.*beds|can you (tell me|confirm|give me).*beds.*baths.*sqft|what('s| is) the.*beds.*baths.*sqft/i.test(lower)) {
        return;
      }
    }
    // Property-type question suppression
    if (isSuppressed(text)) return;
    seen.add(text);
    if (semanticKey) seenSemanticKeys.add(semanticKey);
    const { label, color } = getTag(text);
    results.push({ text, category: label, tagColor: color });
  }

  for (const q of questions) {
    let fullText: string;
    if (typeof q === 'string') {
      fullText = q.trim();
    } else {
      // Support both new backend format ({ category, question }) and legacy ({ title, description })
      const title = toText(q.question ?? q.title ?? q.text ?? q.q ?? '');
      const desc = toText(q.description ?? '');
      fullText = (desc.length > title.length ? desc : title).trim();
    }
    if (!fullText) continue;
    if (/missing data|summary|overview|where to verify|things to verify|questions to ask/i.test(fullText)) continue;
    addQuestion(fullText);
  }

  console.log('[TRACE_Q_AFTER_AI]', results.map(q => q.text));

  // Family deduplication
  const seenFamilies = new Set<number>();
  const deduped: QuestionVM[] = [];
  for (const q of results) {
    let matchedFamily = -1;
    for (let fi = 0; fi < CORE_QUESTION_FAMILIES.length; fi++) {
      if (CORE_QUESTION_FAMILIES[fi].keywords.test(q.text.toLowerCase())) {
        matchedFamily = fi;
        break;
      }
    }
    if (matchedFamily >= 0 && seenFamilies.has(matchedFamily)) continue;
    if (matchedFamily >= 0) seenFamilies.add(matchedFamily);
    deduped.push(q);
  }

  console.log('[TRACE_Q_AFTER_DEDUPE]', deduped.map(q => q.text));
  console.log('[TRACE_Q_FALLBACK_SOURCE]', {
    usingDynamicFallback: !!basicFieldContext,
    effectiveCategory,
    suppressPatternsExists: !!suppressPatterns,
  });

  // ── No template fallback: return only AI questions, deduplicated and capped ─────────
  return deduped.slice(0, maxQuestions);
}

// ── 顶层 viewModel 组装 ───────────────────────────────────────────────────────

export interface HeroVM {
  address: string;
  title: string;
  price: string | null;
  imageUrl: string | null;
  score: number | null;
  verdict: string;
  bottomLine: string;
  nextBestMove: string;
}

export interface SnapshotVM {
  beds: string;
  baths: string;
  sqft: string;
  yearBuilt: string;
  homeType: string;
  tax: string;
  hoa: string;
  daysOnMarket: string;
}

export interface ReportViewModel {
  hero: HeroVM;
  decisionCards: DecisionCardVM[];
  dealRisks: DealRiskVM[];
  snapshot: SnapshotVM;
  price: PriceVM;
  carryingCosts: CarryingCostVM;
  photos: PhotoAnalysisVM;
  spinDecoder: SpinDecoderVM[];
  fit: FitVM;
  questions: QuestionVM[];
  contradictions: ContradictionVM[];
  meta: {
    market: string;
    reportMode: string;
    sourceDomain?: string;
    isBasic: boolean;
    isNYC: boolean;
    reportProfile: string;
    normalizedPropertyCategory: string;
    displayType: string;
  };
  raw: any;
}

/**
 * buildReportViewModel — 结果页数据标准化入口
 * 把原始 result 转换为可稳定渲染的 viewModel.
 * normalizedReport is used to derive the isBasic flag — if not provided,
 * falls back to result.meta.isBasic.
 */
export function buildReportViewModel(
  result: any,
  listingInfo?: any,
  normalizedReport?: { meta?: { isBasic?: boolean; reportProfile?: string; normalizedPropertyCategory?: string } },
): ReportViewModel {
  const raw = result?.raw ?? result;

  console.log('[TRACE_VM_INPUT_RAW]', {
    normalizedPropertyCategory: raw?.normalizedPropertyCategory,
    reportProfile: raw?.reportProfile,
    displayType: raw?.displayType,
    homeType: raw?.property_snapshot?.homeType ?? raw?.property_snapshot?.home_type,
    questions_to_ask: raw?.questions_to_ask,
    questionsToAsk: raw?.questionsToAsk,
    nextBestMove: raw?.nextBestMove,
    next_step: raw?.next_step,
    layout_fit: raw?.layout_fit ?? raw?.layoutFit,
  });

  // isBasic is the authoritative flag from the normalize layer
  const isBasic = normalizedReport?.meta?.isBasic ?? result?.meta?.isBasic ?? false;

  const heroAddr = preferRawFact(
    listingInfo?.address,
    result?.listingInfo?.address,
    raw?.listingOverview?.address,
    raw?.property_snapshot?.address,
  );
  const coreFacts = extractCoreFacts(raw, listingInfo);
  const isNYC = /nyc|new york city|bronx|brooklyn|manhattan|queens|staten/i.test(
    heroAddr || ''
  );

  const imageUrls = extractImageUrls(raw);
  const photoVM = normalizePhotoAnalysis(
    raw?.spaceAnalysis ?? raw?.visualAnalysis ?? {},
    imageUrls,
  );
  const priceVM = normalizePriceCopy(raw?.price_assessment ?? raw?.priceAssessment ?? {});
  const costsVM = normalizeCarryingCosts(raw?.carrying_costs ?? raw?.carryingCosts ?? {});

  const spinRaw = raw?.listing_language_reality_check ?? raw?.listingLanguageRealityCheck ?? [];
  const spinVM = normalizeSpinDecoder(Array.isArray(spinRaw) ? spinRaw : [], {
    isNYC,
    reportProfile: raw?.meta?.reportProfile ?? raw?.reportProfile
      ?? normalizedReport?.meta?.reportProfile
      ?? 'unknown',
  });

  const fitVM = normalizeFitSection(raw?.layout_fit ?? raw?.layoutFit ?? {});

  const questionsRaw = getRawQuestions(raw);
  const questionsVM = normalizeQuestions(
    questionsRaw,
    { isNYC, maxQuestions: isBasic ? 5 : 6, result: raw },
  );
  let finalQuestionsVM = questionsVM;

  const decisionCardsVM = normalizeDecisionCards(
    raw?.riskSignals ?? [],
    raw?.whatLooksGood ?? [],
    photoVM,
  );

  const dealRisksVM = normalizeDealRisks(
    raw?.potentialIssues ?? raw?.hiddenRisks ?? [],
    { isNYC, reportProfile: raw?.meta?.reportProfile ?? raw?.reportProfile
      ?? normalizedReport?.meta?.reportProfile
      ?? 'unknown' },
  );

  const rawScore = raw?.overallScore ?? raw?.overall_score ?? null;
  const effectiveNormCat = raw?.normalizedPropertyCategory
    ?? normalizedReport?.meta?.normalizedPropertyCategory
    ?? raw?.reportProfile
    ?? 'unknown';
  const effectiveDisplayType = raw?.displayType ?? effectiveNormCat;

  // For Basic mode: trust the backend's already-normalized score and verdict.
  // The backend enforces evidence_score caps and recomputes verdict from score.
  // Do NOT recompute here — that would reintroduce inconsistencies.
  const effectiveScore = isBasic
    ? (raw?.overallScore ?? raw?.overall_score ?? raw?.evidence_score ?? 50)
    : tightenSingleFamilyScore(rawScore, raw, coreFacts);

  const effectiveVerdict = isBasic
    ? (raw?.verdict ?? evidenceVerdict(effectiveScore as number))
    : (raw?.verdict ?? raw?.overallVerdict ?? 'Review');

  const rawBottomLine = toText(raw?.bottom_line ?? raw?.bottomLine ?? raw?.quickSummary ?? raw?.quick_summary ?? raw?.summary);
  // Sanitize "and but" / "including, but" artefacts that can slip through the prompt.
  const sanitizeAndBut = (text: string): string => {
    if (/including,\s*but|and\s+but/i.test(text)) {
      return 'This listing has limited verified information. Key facts about condition, comparable sales, and carrying costs are still missing.';
    }
    return text;
  };

  // For basic reports, trust the AI bottom_line completely; for full reports, use
  // the existing single-family fact-based bottom line logic.
  const heroBottomLine = isBasic
    ? (sanitizeAndBut(rawBottomLine) || MODULE_FALLBACKS.HERO_BOTTOM_LINE)
    : (() => {
        const shouldForceFactBottomLine = (
          effectiveNormCat === 'single_family' || effectiveNormCat === 'single_family_owner_occupier'
        ) && (
          !rawBottomLine || aiSummaryConflictsWithFacts(rawBottomLine, coreFacts)
        );
        return shouldForceFactBottomLine
          ? sanitizeAndBut(buildSingleFamilyBottomLine(raw, coreFacts))
          : (sanitizeAndBut(rawBottomLine) || MODULE_FALLBACKS.HERO_BOTTOM_LINE);
      })();

  const hero: HeroVM = {
    address: heroAddr,
    title: preferRawFact(listingInfo?.title, result?.listingInfo?.title, raw?.title ?? ''),
    price: preferRawFact(listingInfo?.price, result?.listingInfo?.price, null),
    imageUrl: imageUrls[0] ?? null,
    score: effectiveScore as number | null,
    verdict: effectiveVerdict,
    bottomLine: heroBottomLine,
    nextBestMove: raw?.nextBestMove ?? raw?.next_step ?? MODULE_FALLBACKS.HERO_NEXT_BEST_MOVE_DEFAULT,
  };

  const snap = raw?.property_snapshot ?? {};
  const snapshot: SnapshotVM = {
    beds: preferRawFact(listingInfo?.bedrooms, snap?.beds),
    baths: preferRawFact(listingInfo?.bathrooms, snap?.baths),
    sqft: fmtSqft(preferRawFact(snap?.sqft, snap?.squareFeet, snap?.sqft ?? snap?.square_feet)),
    yearBuilt: snap?.yearBuilt ?? snap?.year_built ?? '',
    homeType: (effectiveDisplayType || snap?.homeType) ?? snap?.home_type ?? '',
    tax: snap?.annualTax ?? snap?.annual_tax
      ? fmtMoney(snap.annualTax ?? snap.annual_tax)
      : '',
    hoa: toText(snap?.hoa),
    daysOnMarket: snap?.daysOnMarket ?? snap?.days_on_market ?? snap?.date_listed ?? '',
  };

  const listingEvidenceText = [
    raw?.listingInfo?.description,
    raw?.listingInfo?.highlights,
    raw?.description,
    raw?.quickSummary,
    raw?.quick_summary,
    raw?.summary,
    raw?.nextBestMove,
    raw?.next_step,
    raw?.property_snapshot?.home_type,
    raw?.property_snapshot?.homeType,
    raw?.propertyType,
    raw?.homeType,
    snap?.homeType,
    snap?.home_type,
    effectiveDisplayType,
  ]
    .map(value => toText(value))
    .join(' ');

  type SingleFamilyDisplayMode =
    | 'question'
    | 'nextBestMove'
    | 'decisionTitle'
    | 'decisionExplanation'
    | 'fit'
    | 'generic';

  const isSingleFamilyLike =
    effectiveNormCat === 'single_family_owner_occupier' ||
    effectiveNormCat === 'single_family' ||
    /single family|singlefamily|single-family|single family residence/i.test(String(effectiveDisplayType || '')) ||
    /single family|singlefamily|single-family|single family residence/i.test(String(snapshot.homeType || ''));

  const hasExplicitRentalEvidence =
    // Require explicit legal / rental signals — NOT marketing language like "duplex home" or "two-family layout"
    // Must match actual legal-use, rental, or multi-unit evidence
    /legal 2-?family|legal two-?family|multi-?family|legal apartment|legal unit|rent roll|tenant occupied|unit 1|unit 2|separate meters.*(unit|tenant)|current lease|rental income disclosed/i.test(listingEvidenceText);

  const shouldApplyFinalSingleFamilySanitizer = isSingleFamilyLike && !hasExplicitRentalEvidence;

  function collapseWhitespace(text: string): string {
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  function sanitizeSingleFamilyDisplayText(text: string, mode: SingleFamilyDisplayMode): string {
    const input = toText(text);
    if (!input) return '';

    if (mode === 'question') {
      if (/legal two-family|two-family status|second unit|actual rent|rental income|rent roll|income unit/i.test(input)) {
        return 'Can you provide the Certificate of Occupancy or legal-use documents confirming the permitted use of this property?';
      }
      if (/\bDOB\b|\bHPD\b|\bECB\b|\bOATH\b/i.test(input)) {
        return 'Are there any open DOB permits, ECB/OATH violations, complaints, or unresolved building issues for this address?';
      }
      return collapseWhitespace(input);
    }

    if (mode === 'nextBestMove') {
      if (/rental income|second unit|income unit|rent roll|actual rent|two-family/i.test(input)) {
        return 'Keep this property on your shortlist, but do not rely on legal-use assumptions, basement use assumptions, or the asking price until condition, major systems, and nearby comps are verified.';
      }
      return collapseWhitespace(input);
    }

    if (mode === 'decisionTitle') {
      if (/rental legality risk/i.test(input)) {
        return 'Basement condition and permitted use';
      }
      return collapseWhitespace(input);
    }

    if (mode === 'decisionExplanation') {
      let cleaned = input;
      cleaned = cleaned.replace(/Could affect rental income/gi, 'Could affect usable value');
      cleaned = cleaned.replace(/rental income/gi, 'documented rent support');
      cleaned = cleaned.replace(/second unit/gi, 'claimed second-unit setup');
      cleaned = cleaned.replace(/income unit/gi, 'claimed income setup');
      cleaned = cleaned.replace(/two-family/gi, 'legal two-family use');
      cleaned = cleaned.replace(/\bDOB\b\s*\/\s*\bHPD\b/gi, 'local building department records');
      cleaned = cleaned.replace(/\bDOB\b/gi, 'local building department');
      cleaned = cleaned.replace(/\bHPD\b/gi, 'local building department records');
      return collapseWhitespace(cleaned);
    }

    if (mode === 'fit') {
      if (/duplex|rental-ready unit|legal separate apartment|rental income|legal two-family/i.test(input)) {
        return 'Buyers relying on multi-unit use or rental income without verified legal approvals';
      }
      return collapseWhitespace(input);
    }

    let cleaned = input;
    cleaned = cleaned.replace(/Could affect rental income/gi, 'Could affect usable value');
    cleaned = cleaned.replace(/rental income/gi, 'documented rent support');
    cleaned = cleaned.replace(/second unit/gi, 'claimed second-unit setup');
    cleaned = cleaned.replace(/actual rent/gi, 'documented current use');
    cleaned = cleaned.replace(/rent roll/gi, 'rent roll and lease records');
    cleaned = cleaned.replace(/income unit/gi, 'claimed income setup');
    cleaned = cleaned.replace(/\bDOB\b\s*\/\s*\bHPD\b/gi, 'local building department records');
    cleaned = cleaned.replace(/\bDOB\b/gi, 'local building department');
    cleaned = cleaned.replace(/\bHPD\b/gi, 'local building department records');
    return collapseWhitespace(cleaned);
  }

  function shouldRetitleRentalLegalityCard(card: DecisionCardVM): boolean {
    return /rental legality risk/i.test(card.title ?? '')
      && /basement|permit|permitted|unpermitted|egress|legal sqft|ceiling height|occupancy/i.test(card.explanation ?? '')
      && !/tenant|lease|cash flow|rent collection/i.test(card.explanation ?? '');
  }

  function ensureSingleFamilySafetyQuestions(items: QuestionVM[], maxQuestions: number): QuestionVM[] {
    if (!shouldApplyFinalSingleFamilySanitizer) return items;

    const required: QuestionVM[] = [
      { text: 'Can you confirm the basement’s current use, condition, access, permits, and whether any basement area is included in legal rentable space?', category: 'Legal', tagColor: 'bg-violet-100 text-violet-700' },
      { text: 'Are there any open DOB permits, ECB/OATH violations, complaints, or unresolved building issues for this address?', category: 'Legal', tagColor: 'bg-violet-100 text-violet-700' },
      { text: 'Has the basement had water intrusion, foundation repairs, or drainage issues?', category: 'Basement', tagColor: 'bg-blue-100 text-blue-700' },
      { text: 'How old are the roof, boiler, electrical panel, plumbing, and HVAC systems?', category: 'Systems', tagColor: 'bg-orange-100 text-orange-700' },
      { text: 'Can you provide the actual insurance quote, average utility costs, and any owner-paid expenses beyond the listing estimate?', category: 'Costs', tagColor: 'bg-teal-100 text-teal-700' },
      { text: 'Can you provide recent comparable sales for similar properties in the area?', category: 'Price', tagColor: 'bg-amber-100 text-amber-700' },
    ];

    const next = [...items];
    const existingText = new Set(next.map(q => q.text));
    const existingCategory = new Set(next.map(q => q.category));

    for (const candidate of required) {
      if (next.length >= maxQuestions) break;
      if (existingText.has(candidate.text)) continue;
      if (candidate.category !== 'Legal' && existingCategory.has(candidate.category)) continue;
      next.push(candidate);
      existingText.add(candidate.text);
      existingCategory.add(candidate.category);
    }

    return next.slice(0, maxQuestions);
  }

  function applySingleFamilyFinalSanitizer(viewModel: {
    hero: HeroVM;
    decisionCards: DecisionCardVM[];
    fit: FitVM | null;
    questions: QuestionVM[];
  }): void {
    viewModel.hero.bottomLine = sanitizeSingleFamilyDisplayText(viewModel.hero.bottomLine ?? '', 'generic');
    viewModel.hero.nextBestMove = sanitizeSingleFamilyDisplayText(viewModel.hero.nextBestMove ?? '', 'nextBestMove');

    // Only retain AI questions — no template fallback, no padding
    viewModel.questions = (viewModel.questions ?? [])
      .filter((q: QuestionVM) => q?.text && q.text.trim().length > 0)
      .slice(0, isBasic ? 5 : 6);

    for (const card of viewModel.decisionCards) {
      if (shouldRetitleRentalLegalityCard(card)) {
        card.title = 'Basement condition and permitted use';
      } else {
        card.title = sanitizeSingleFamilyDisplayText(card.title ?? '', 'decisionTitle');
      }
      card.explanation = sanitizeSingleFamilyDisplayText(card.explanation ?? '', 'decisionExplanation');
      card.badge = sanitizeSingleFamilyDisplayText(card.badge ?? '', 'decisionExplanation');
    }

    if (viewModel.fit) {
      viewModel.fit.notIdealFor = Array.from(
        new Set(
          (viewModel.fit.notIdealFor ?? [])
            .map(item => sanitizeSingleFamilyDisplayText(item, 'fit'))
            .filter(Boolean),
        ),
      );

      if (viewModel.fit.notIdealFor.length === 0) {
        viewModel.fit.notIdealFor = ['Buyers relying on multi-unit use or rental income without verified legal approvals'];
      }

      viewModel.fit.whyItMatters = sanitizeSingleFamilyDisplayText(viewModel.fit.whyItMatters ?? '', 'generic');
    }
  }

  // Contradiction detection — always runs regardless of isBasic
  const contradictions = detectContradictions(raw);

  const viewModel = {
    hero,
    decisionCards: decisionCardsVM,
    dealRisks: dealRisksVM,
    snapshot,
    price: priceVM,
    carryingCosts: costsVM,
    photos: photoVM,
    spinDecoder: spinVM,
    fit: fitVM,
    questions: finalQuestionsVM,
    contradictions,
    meta: {
      market: result?.meta?.market ?? 'US',
      reportMode: result?.meta?.reportMode ?? 'unknown',
      sourceDomain: result?.meta?.sourceDomain,
      isBasic,
      isNYC,
      reportProfile: raw?.meta?.reportProfile ?? raw?.reportProfile
        ?? normalizedReport?.meta?.reportProfile
        ?? 'unknown',
      normalizedPropertyCategory: effectiveNormCat,
      displayType: effectiveDisplayType,
    },
    raw,
  };

  if (shouldApplyFinalSingleFamilySanitizer) {
    applySingleFamilyFinalSanitizer(viewModel);
  }

  console.log('[HomeScope Questions Source]', {
    usedSingleFamilySafetyFallback: false,
    questions: viewModel.questions.map((q: QuestionVM) => q.text),
  });

  console.log('[FINAL_SANITIZED_VM]', {
    isSingleFamilyLike,
    hasExplicitRentalEvidence,
    questions: viewModel.questions.map(q => q.text),
    nextBestMove: viewModel.hero.nextBestMove,
    decisionCards: viewModel.decisionCards.map(c => ({
      title: c.title,
      explanation: c.explanation,
      badge: c.badge,
    })),
    fitNotIdealFor: viewModel.fit?.notIdealFor,
  });

  return viewModel;
}
