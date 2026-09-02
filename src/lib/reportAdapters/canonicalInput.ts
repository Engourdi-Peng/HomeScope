// ===== canonicalInput — 报告输入唯一装配器 =====
//
// Single source of truth for how an AnalysisResult gets assembled from:
//   - backend-returned AnalysisResult (authoritative for AI fields)
//   - frontend-extracted listingData (V1/V2) — falls back for fields the
//     backend may not have populated (title, address, beds/baths/sqft,
//     image gallery, etc.)
//
// Both the web result page (Account.tsx history replay, Share.tsx public,
// Result.tsx sessionStorage) and the extension side-panel
// (ExtensionResultView via store.tsx) MUST go through this assembler so
// that the same `analysisId` produces the same canonical input on both
// surfaces.
//
// Merge strategy (priority for each field):
//   1. Backend result.listingInfo (analysis-time authoritative data)
//   2. Backend result-level fields (property_snapshot, what_we_know, …)
//   3. Frontend listingData (only when neither backend source has the field)
//
// For images:
//   1. Backend listingInfo.images (from analysis) — preferred
//   2. Frontend listingData.imageUrls / images — fallback
//
// For reportMode:
//   - prefer the explicit top-level field (analysis_meta.report_mode,
//     result.reportMode), fall back to listingData.reportMode.
//
// The output is a NEW AnalysisResult with `listingInfo` populated using
// the merged fields; existing top-level fields on the result are kept
// verbatim.

import type { AnalysisResult } from '../../types';
import type { ListingInfo } from '../../../shared/types/analysis';

// ---- Minimal shape of frontend-extracted listing data ----------------------
// Matches ListingData / ListingDataV2 in src/types/index.ts. Defined locally
// to keep this module decoupled from extension-only imports.
interface FrontendListingShape {
  title?: string;
  address?: string;
  price?: string;
  priceText?: string;
  priceAmount?: number;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parking?: number | null;
  sqft?: number | string | null;
  propertyType?: string | null;
  yearBuilt?: number | string | null;
  annualTax?: string | number | null;
  floodZone?: string | null;
  heating?: string | null;
  cooling?: string | null;
  basement?: string | null;
  imageUrls?: string[];
  images?: string[];
  coverImageUrl?: string;
  listingUrl?: string;
  url?: string;
  source?: { url?: string; domain?: string };
  sourceDomain?: string | null;
  reportMode?: 'rent' | 'sale';
  listingType?: 'rent' | 'sale' | 'unknown';
  [key: string]: unknown;
}

// ---- Field helpers ---------------------------------------------------------

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? t : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function asImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t.startsWith('http')) out.push(t);
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      for (const key of ['url', 'src', 'href', 'srcUrl', 'imageUrl']) {
        const v = obj[key];
        if (typeof v === 'string' && v.startsWith('http')) {
          out.push(v);
          break;
        }
      }
    }
  }
  return out;
}

function getPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, obj);
}

/** Try multiple paths in priority order — first non-empty wins. */
function pickFirst<T>(
  obj: any,
  paths: string[],
  cast: (v: unknown) => T | null,
): T | null {
  for (const path of paths) {
    const value = path.includes('.') ? getPath(obj, path) : obj?.[path];
    const casted = cast(value);
    if (casted != null && casted !== '') return casted;
  }
  return null;
}

// ---- Field merge rules -----------------------------------------------------
//
// Each tuple: [field key in ListingInfo, list of candidate paths on the
// backend result, cast helper]. The frontend listingData is consulted as a
// last resort only.
type MergeRule =
  | { key: keyof ListingInfo; backendPaths: string[]; cast: (v: unknown) => string | number | null; frontendKey: keyof FrontendListingShape }
  | { key: keyof ListingInfo; backendPaths: string[]; cast: (v: unknown) => string | number | null; frontendKey?: never };

const MERGE_RULES: Array<MergeRule> = [
  { key: 'title',       backendPaths: ['listingInfo.title', 'title'],                                       cast: asText,   frontendKey: 'title' },
  { key: 'address',     backendPaths: ['listingInfo.address', 'property_snapshot.address', 'address'],       cast: asText,   frontendKey: 'address' },
  { key: 'price',       backendPaths: ['listingInfo.price', 'price', 'askingPrice'],                         cast: asText,   frontendKey: 'price' },
  { key: 'priceAmount', backendPaths: ['listingInfo.priceAmount', 'priceAmount', 'weekly_rent'],             cast: asNumber, frontendKey: 'priceAmount' },
  { key: 'bedrooms',    backendPaths: ['listingInfo.bedrooms', 'bedrooms', 'beds'],                          cast: asNumber, frontendKey: 'bedrooms' },
  { key: 'bathrooms',   backendPaths: ['listingInfo.bathrooms', 'bathrooms', 'baths'],                       cast: asNumber, frontendKey: 'bathrooms' },
  { key: 'parking',     backendPaths: ['listingInfo.parking', 'parking', 'car_spaces'],                      cast: asNumber, frontendKey: 'parking' },
  { key: 'sqft',        backendPaths: ['listingInfo.sqft', 'sqft', 'property_snapshot.sqft'],                cast: (v) => asNumber(v) ?? (asText(v) as string | null), frontendKey: 'sqft' },
  { key: 'propertyType', backendPaths: ['listingInfo.propertyType', 'propertyType', 'property_snapshot.homeType'], cast: asText, frontendKey: 'propertyType' },
  { key: 'yearBuilt',   backendPaths: ['listingInfo.yearBuilt', 'yearBuilt', 'property_snapshot.yearBuilt'],  cast: (v) => asNumber(v) ?? (asText(v) as string | null), frontendKey: 'yearBuilt' },
  { key: 'annualTax',   backendPaths: ['listingInfo.annualTax', 'annualTax', 'annual_tax'],                  cast: asText,   frontendKey: 'annualTax' },
  { key: 'floodZone',   backendPaths: ['listingInfo.floodZone', 'floodZone'],                                cast: asText,   frontendKey: 'floodZone' },
  { key: 'heating',     backendPaths: ['listingInfo.heating', 'heating'],                                    cast: asText,   frontendKey: 'heating' },
  { key: 'cooling',     backendPaths: ['listingInfo.cooling', 'cooling'],                                    cast: asText,   frontendKey: 'cooling' },
  { key: 'basement',    backendPaths: ['listingInfo.basement', 'basement'],                                  cast: asText,   frontendKey: 'basement' },
];

// ---- reportMode resolution -------------------------------------------------

type ReportModeResult = { reportMode: 'rent' | 'sale' | undefined };

function resolveReportMode(
  result: any,
  listingData: FrontendListingShape | null,
): ReportModeResult {
  // 1. analyses table top-level report_mode (set by Share.tsx replay and basic sync).
  const fromAnalysesTable = (result as any)?.report_mode;
  if (fromAnalysesTable === 'rent' || fromAnalysesTable === 'sale') {
    return { reportMode: fromAnalysesTable };
  }
  // 2. Backend result.reportMode.
  const fromResult = result?.reportMode;
  if (fromResult === 'rent' || fromResult === 'sale') {
    return { reportMode: fromResult };
  }
  // 3. Backend nested meta.reportMode.
  const fromMeta = (result as any)?.meta?.reportMode;
  if (fromMeta === 'rent' || fromMeta === 'sale') {
    return { reportMode: fromMeta };
  }
  // 4. listingData.reportMode / listingType.
  if (listingData?.reportMode === 'rent' || listingData?.reportMode === 'sale') {
    return { reportMode: listingData.reportMode };
  }
  if (listingData?.listingType === 'rent' || listingData?.listingType === 'sale') {
    return { reportMode: listingData.listingType };
  }
  return { reportMode: undefined };
}

// ---- Image resolution ------------------------------------------------------

interface ImageResolution {
  coverImageUrl: string | null;
  images: string[];
}

/**
 * Pick canonical images with this priority:
 *   1. Backend listingInfo.coverImageUrl (single, explicit cover) — preferred
 *   2. Frontend listingData.coverImageUrl (explicit cover)
 *   3. Backend listingInfo.images (analysis-time authoritative gallery)
 *   4. Backend top-level images array
 *   5. Frontend listingData.imageUrls / images
 *
 * The cover image is the first image in the merged deduped list. We
 * prepend explicit cover URLs (backend first, then frontend) so that an
 * explicit cover remains the hero even if it isn't the first gallery
 * image.
 */
function resolveImages(
  result: any,
  listingData: FrontendListingShape | null,
): ImageResolution {
  const backendCover = asText(result?.listingInfo?.coverImageUrl);
  const frontendCover = asText(listingData?.coverImageUrl);
  const backendListingInfoImages = asImages(result?.listingInfo?.images);
  const backendTopImages = asImages(result?.images);
  const frontendImages =
    asImages(listingData?.images).length > 0
      ? asImages(listingData?.images)
      : asImages(listingData?.imageUrls);

  // Build a candidate order: explicit covers first, then galleries.
  // De-dupe while preserving order.
  const mergedImages = [
    ...(backendCover ? [backendCover] : []),
    ...(frontendCover ? [frontendCover] : []),
    ...backendListingInfoImages,
    ...backendTopImages,
    ...frontendImages,
  ];
  // De-dupe while preserving order.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const url of mergedImages) {
    if (!seen.has(url)) {
      seen.add(url);
      deduped.push(url);
    }
  }
  const coverImageUrl = deduped[0] ?? null;
  return { coverImageUrl, images: deduped };
}

// ---- Main assembler --------------------------------------------------------

export interface CanonicalReportInput {
  /** Result with `listingInfo` populated from the merged priority order. */
  result: AnalysisResult;
  /** Image collection — `result.images` and `result.listingInfo.images` mirror this. */
  images: string[];
  /** Final cover image URL used by the hero card. */
  coverImageUrl: string | null;
}

/**
 * Build the canonical input that both web and extension will hand to
 * `normalizeReportResult` → `buildReportViewModel` → `NewReportUI`.
 *
 * `result` is the backend AnalysisResult (or a partial — the assembler
 * tolerates missing fields).
 * `listingData` is the optional frontend extraction (ListingData or
 * ListingDataV2). Pass `null` if no frontend data is available (history
 * replay without cached listing data, for example).
 *
 * The function never mutates its inputs; it returns a fresh object.
 */
export function buildCanonicalReportInput(
  result: AnalysisResult | null | undefined,
  listingData: FrontendListingShape | null,
): CanonicalReportInput {
  const source: any = result ?? {};
  const merged: ListingInfo = { ...(source?.listingInfo ?? {}) };

  // 1. Merge structured fields with priority (backend → backend snapshot → frontend).
  for (const rule of MERGE_RULES) {
    const backendValue = pickFirst<any>(source, rule.backendPaths, rule.cast);
    let finalValue: string | number | null = backendValue;
    if (finalValue == null && listingData && rule.frontendKey) {
      finalValue = rule.cast(listingData[rule.frontendKey]);
    }
    if (finalValue != null && finalValue !== '') {
      // Cast to the proper ListingInfo field type.
      (merged as any)[rule.key] = finalValue;
    }
  }

  // 2. Resolve images & cover image.
  const { coverImageUrl, images } = resolveImages(source, listingData);
  if (coverImageUrl) merged.coverImageUrl = coverImageUrl;
  // `images` is not in the `ListingInfo` interface, but is required by the
  // report adapters (normalizeReport.pickFirstImage / buildReportViewModel.
  // extractImageUrls) so we attach it with a type cast — same pattern the
  // previous `injectListingInfo` used.
  if (images.length > 0) (merged as any).images = images;

  // 3. Resolve reportMode and propagate.
  const { reportMode } = resolveReportMode(source, listingData);
  const resultOut: AnalysisResult = {
    ...source,
    listingInfo: Object.keys(merged).length > 0 ? merged : null,
  };
  if (reportMode) resultOut.reportMode = reportMode;

  // 4. Top-level `images` mirror — pickFirstImage() in normalizeReport.ts
  //    reads this as the primary fallback when listingInfo.images is empty.
  if (images.length > 0) {
    (resultOut as AnalysisResult & { images?: string[] }).images = images;
  }

  return {
    result: resultOut,
    images,
    coverImageUrl,
  };
}
