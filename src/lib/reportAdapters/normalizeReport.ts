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
function buildAddress(result: AnyResult): string {
  const paths = [
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
  // Ensure hero.address is always the canonical address from raw source
  const canonicalAddress = buildAddress(result);
  if (canonicalAddress) normalized.hero.address = canonicalAddress;
  const canonicalTitle = buildTitle(result);
  if (canonicalTitle) normalized.hero.title = canonicalTitle;

  return normalized;
}
