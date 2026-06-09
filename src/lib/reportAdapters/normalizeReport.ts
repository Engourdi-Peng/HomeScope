// ===== normalizeReport — 统一入口 =====
// 检测 result 的 market / reportMode / isBasic，分发到对应 adapter

import type { NormalizedReport, Market, ReportMode } from './types';
import { normalizeUSSaleReport } from './usSale';
import { normalizeAUSaleReport } from './auSale';
import { normalizeAURentReport } from './auRent';
import { normalizeGenericReport } from './generic';

type AnyResult = any;

// ---- field name normalizers ----

function getPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, obj);
}

function getField(result: AnyResult, ...paths: string[]): any {
  for (const path of paths) {
    const value = path.includes('.')
      ? getPath(result, path)
      : result?.[path];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

// ---- detect market ----
function detectMarket(result: AnyResult): Market {
  const m = getField(result, 'market', 'Market');
  if (m === 'US' || m === 'AU') return m;

  const domain = getField(result, 'sourceDomain', 'source_domain', 'source', 'Source') ?? '';
  const domainStr = typeof domain === 'string' ? domain.toLowerCase() : '';
  if (domainStr.includes('zillow') || domainStr.includes('realtor')) return 'US';
  if (domainStr.includes('realestate') || domainStr.includes('domain') || domainStr.includes('allhomes')) return 'AU';

  const hasUSModules = result?.property_snapshot ?? result?.carrying_costs ?? result?.maintenance_risk ?? false;
  const hasAUModules = result?.stampDuty ?? result?.land_value_analysis ?? result?.deal_breakers ?? false;

  if (hasUSModules && !hasAUModules) return 'US';
  if (hasAUModules && !hasUSModules) return 'AU';

  const mode = detectReportMode(result);
  if (mode === 'rent') return 'AU';

  return 'UNKNOWN';
}

// ---- detect report mode ----
function detectReportMode(result: AnyResult): ReportMode {
  const mode = getField(result, 'reportMode', 'report_mode', 'analysisType', 'mode');
  if (mode === 'sale') return 'sale';
  if (mode === 'rent') return 'rent';
  return 'unknown';
}

// ---- detect basic result ----
// Priority: explicit analysisType='basic' > legacy 'decision' format > no deep modules
function detectBasicResult(result: AnyResult): boolean {
  if (getField(result, 'analysisType') === 'basic') return true;
  if ('decision' in result && result.decision !== undefined) return true;
  if (!result?.property_snapshot && !result?.carrying_costs && !result?.price_assessment && !result.overallScore) return true;
  return false;
}

// ---- safe text ----
function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'function') return '';
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  if (typeof value === 'object') return '';
  return '';
}

// ---- pickFirstImage ----
function isLikelyPlaceholder(url: string): boolean {
  return /icon|logo|avatar|placeholder|default|1x1|pixel|blank/i.test(url);
}

function extractUrl(item: unknown): string {
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    for (const key of ['url', 'src', 'href', 'srcUrl', 'imageUrl', 'thumbnail']) {
      const v = obj[key];
      if (typeof v === 'string' && v.startsWith('http')) return v.trim();
    }
  }
  return '';
}

function pickFirstImage(result: AnyResult): string | undefined {
  // String field candidates — dot-path for nested, plain key for top-level
  const stringCandidates = [
    getField(result, 'listingInfo.coverImageUrl'),
    getField(result, 'listingInfo.image'),
    getField(result, 'listingInfo.imageUrl'),
    getField(result, 'listingInfo.thumbnail'),
    getField(result, 'coverImageUrl'),
    getField(result, 'cover_image_url'),
    getField(result, 'imageUrl'),
    getField(result, 'image_url'),
    getField(result, 'heroImage'),
    getField(result, 'hero_image'),
    getField(result, 'thumbnailUrl'),
    getField(result, 'thumbnail_url'),
    getField(result, 'mainImage'),
    getField(result, 'main_image'),
  ];

  for (const value of stringCandidates) {
    if (value == null) continue;
    if (typeof value === 'string' && value.startsWith('http') && !isLikelyPlaceholder(value)) {
      return value;
    }
  }

  // Array field candidates — dot-path for nested arrays
  const arrayCandidates = [
    getField(result, 'listingInfo.images'),
    getField(result, 'listingInfo.photos'),
    getField(result, 'listingInfo.photoUrls'),
    getField(result, 'listingInfo.imageUrls'),
    getField(result, 'images'),
    getField(result, 'photos'),
    getField(result, 'photoUrls'),
    getField(result, 'photo_urls'),
    getField(result, 'imageUrls'),
    getField(result, 'image_urls'),
    getField(result, 'listingImages'),
    getField(result, 'listing_images'),
    getField(result, 'raw.images'),
    getField(result, 'raw.photos'),
  ];

  for (const arr of arrayCandidates) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const url = extractUrl(item);
      if (url && url.startsWith('http') && !isLikelyPlaceholder(url)) {
        return url;
      }
    }
  }

  return undefined;
}

// ---- buildAddress (safe, no price/beds baked in) ----
// Priority: verifiedFacts.address (deterministic backend data) > listingInfo.address >
// property_snapshot.address > propertySnapshot.address > fullAddress > full_address > address
function buildAddress(result: AnyResult): string {
  const paths = [
    () => getField(result, 'verifiedFacts.address'),
    () => getField(result, 'listingInfo.address'),
    () => getField(result, 'property_snapshot.address'),
    () => getField(result, 'propertySnapshot.address'),
    () => getField(result, 'fullAddress'),
    () => getField(result, 'full_address'),
    () => getField(result, 'address'),
  ];
  for (const fn of paths) {
    const v = fn();
    const t = toText(v);
    if (t) return t;
  }
  return '';
}

// ---- buildTitle (clean, no price/beds baked in) ----
function buildTitle(result: AnyResult): string {
  const paths = [
    () => getField(result, 'listingInfo.title'),
    () => getField(result, 'propertyTitle'),
    () => getField(result, 'property_title'),
    () => getField(result, 'listingTitle'),
    () => getField(result, 'listing_title'),
    () => getField(result, 'title'),
  ];
  for (const fn of paths) {
    const v = fn();
    const t = toText(v);
    if (t) return t;
  }
  return '';
}

// ── Listing summary / dirty data filters ──────────────────────────────────────

function isListingSummaryString(value: unknown): boolean {
  if (!value) return true;
  const text = String(value).trim();
  if (!text) return true;
  return (
    /\b\d+\s*bds\b/i.test(text) ||
    /\b\d+\s*beds?\b/i.test(text) ||
    /\b\d+\s*ba\b/i.test(text) ||
    /\b\d+[,.\d]*\s*sqft\b/i.test(text) ||
    /\b\d+\s*sq\s*ft\b/i.test(text) ||
    /home\s+for\s+sale\b/i.test(text) ||
    /\bactive\b/i.test(text) ||
    /\bmulti\.?family\s+home\s+for\s+sale\b/i.test(text) ||
    /\bsingle\s+family\s+home\s+for\s+sale\b/i.test(text) ||
    /\bcondo\s+for\s+sale\b/i.test(text) ||
    /\btownhouse\s+for\s+sale\b/i.test(text)
  );
}

function isLikelyValidAddress(value: unknown): boolean {
  if (!value) return false;
  const text = String(value).trim();
  if (!text) return false;

  if (isListingSummaryString(text)) return false;

  // Accept complete US address: "1231 Lydig Avenue, Bronx, NY 10461"
  if (/^\d[\d-]*\s+.+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?$/i.test(text)) {
    return true;
  }

  // Accept partial street address: "810 Neill Avenue", "1231 Lydig Avenue", "119-06 229th St #1"
  // \d[\d-]* handles hyphenated street numbers like "119-06", "33-30"
  if (/^\d[\d-]*\s+[A-Za-z0-9 .'-]+(?:street|st|avenue|ave|road|rd|place|pl|drive|dr|court|ct|lane|ln|boulevard|blvd|terrace|ter|way|circle|cir|floor)\b/i.test(text)) {
    return true;
  }

  return false;
}

function firstValidAddress(...values: unknown[]): string {
  for (const v of values) {
    const text = String(v ?? '').trim();
    if (isLikelyValidAddress(text)) return text;
  }
  return '';
}

function firstValidTitle(...values: unknown[]): string {
  for (const v of values) {
    const text = String(v ?? '').trim();
    if (text && !isListingSummaryString(text)) return text;
  }
  return '';
}

// ---- main export ----
export function normalizeReportResult(result: AnyResult): NormalizedReport {
  const market = detectMarket(result);
  const reportMode = detectReportMode(result);
  const isBasic = detectBasicResult(result);

  let normalized: NormalizedReport;

  if (isBasic) {
    normalized = normalizeGenericReport(result);
  } else if (market === 'US' && reportMode === 'sale') {
    normalized = normalizeUSSaleReport(result);
  } else if (market === 'AU' && reportMode === 'sale') {
    normalized = normalizeAUSaleReport(result);
  } else if (market === 'AU' && reportMode === 'rent') {
    normalized = normalizeAURentReport(result);
  } else if (market === 'US' && reportMode === 'rent') {
    normalized = normalizeGenericReport(result);
  } else {
    normalized = normalizeGenericReport(result);
  }

  // Fill hero.imageUrl from result — always from raw result, not adapter output
  // Adapter's hero.title / hero.address may differ; we want the canonical identity from the source
  normalized.hero.imageUrl = pickFirstImage(result);

  // ── Canonical address: filter out listing summary strings ──────────────────────
  const addressCandidates = [
    { path: 'verifiedFacts.address', value: result?.verifiedFacts?.address },
    { path: 'listingInfo.address', value: result?.listingInfo?.address },
    { path: 'property_snapshot.address', value: result?.property_snapshot?.address },
    { path: 'property_snapshot.region', value: result?.property_snapshot?.region },
    { path: 'propertySnapshot.address', value: result?.propertySnapshot?.address },
    { path: 'propertySnapshot.region', value: result?.propertySnapshot?.region },
    { path: 'address', value: result?.address },
    { path: 'region', value: result?.region },
    { path: 'result.verifiedFacts.address', value: (result as any)?.result?.verifiedFacts?.address },
    { path: 'result.listingInfo.address', value: (result as any)?.result?.listingInfo?.address },
    { path: 'result.property_snapshot.address', value: (result as any)?.result?.property_snapshot?.address },
    { path: 'result.property_snapshot.region', value: (result as any)?.result?.property_snapshot?.region },
    { path: 'full_result.verifiedFacts.address', value: (result as any)?.full_result?.verifiedFacts?.address },
    { path: 'full_result.listingInfo.address', value: (result as any)?.full_result?.listingInfo?.address },
    { path: 'full_result.property_snapshot.address', value: (result as any)?.full_result?.property_snapshot?.address },
    { path: 'full_result.property_snapshot.region', value: (result as any)?.full_result?.property_snapshot?.region },
  ];

  const canonicalAddress = firstValidAddress(...addressCandidates.map(c => c.value));

  // ── Canonical title: filter out listing summary strings ───────────────────────
  const titleValues = [
    result?.listingInfo?.title,
    result?.propertyTitle,
    result?.property_title,
    result?.listingTitle,
    result?.listing_title,
    result?.title,
  ];
  const canonicalTitle = firstValidTitle(...titleValues);

  console.log('[HS NORMALIZE INPUT]', {
    listingInfoAddress: result?.listingInfo?.address,
    listingInfoTitle: result?.listingInfo?.title,
    propertySnapshotAddress: result?.property_snapshot?.address,
    rawTitle: result?.title,
    rawAddress: result?.address,
  });
  console.log('[HS NORMALIZE OUTPUT]', {
    canonicalAddress,
    canonicalTitle,
  });

  // Always overwrite — never skip if value is falsy
  normalized.hero.address = canonicalAddress;
  // Title: avoid duplicate when title === address (both are the full address string).
  // If title differs from address, use it; otherwise null → falls back to 'Property report'.
  normalized.hero.title = canonicalTitle && canonicalTitle !== canonicalAddress ? canonicalTitle : null;

  return normalized;
}
