// ===== normalizeReport — 统一入口 =====
// 检测 result 的 market / reportMode / isBasic，分发到对应 adapter

import type { NormalizedReport, Market, ReportMode } from './types';
import { normalizeUSSaleReport } from './usSale';
import { normalizeAUSaleReport } from './auSale';
import { normalizeAURentReport } from './auRent';
import { normalizeGenericReport } from './generic';

type AnyResult = any;

// ---- field name normalizers ----

function getField(result: AnyResult, ...paths: string[]): any {
  for (const p of paths) {
    if (result?.[p] !== undefined) return result[p];
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
  const candidates: Array<[string, unknown]> = [
    ['listingInfo.coverImageUrl', getField(result, 'listingInfo', 'coverImageUrl')],
    ['listingInfo.image', getField(result, 'listingInfo', 'image')],
    ['listingInfo.imageUrl', getField(result, 'listingInfo', 'imageUrl')],
    ['listingInfo.thumbnail', getField(result, 'listingInfo', 'thumbnail')],
    ['coverImageUrl', result.coverImageUrl],
    ['cover_image_url', result.cover_image_url],
    ['imageUrl', result.imageUrl],
    ['image_url', result.image_url],
    ['heroImage', result.heroImage],
    ['hero_image', result.hero_image],
    ['thumbnailUrl', result.thumbnailUrl],
    ['thumbnail_url', result.thumbnail_url],
    ['images', result.images],
    ['photos', result.photos],
    ['photoUrls', result.photoUrls],
    ['photo_urls', result.photo_urls],
    ['imageUrls', result.imageUrls],
    ['image_urls', result.image_urls],
    ['listingImages', result.listingImages],
    ['listing_images', result.listing_images],
    ['raw.images', getField(result, 'raw', 'images')],
    ['raw.photos', getField(result, 'raw', 'photos')],
  ];

  for (const [, value] of candidates) {
    if (value == null) continue;
    if (typeof value === 'string') {
      if (value.startsWith('http') && !isLikelyPlaceholder(value)) return value;
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const url = extractUrl(item);
        if (url && url.startsWith('http') && !isLikelyPlaceholder(url)) return url;
      }
    }
  }

  return undefined;
}

// ---- buildAddress (safe, no price/beds baked in) ----
function buildAddress(result: AnyResult): string {
  const paths = [
    () => getField(result, 'listingInfo', 'address'),
    () => getField(result, 'property_snapshot', 'address'),
    () => getField(result, 'propertySnapshot', 'address'),
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
    () => getField(result, 'listingInfo', 'title'),
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
