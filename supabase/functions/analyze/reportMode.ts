// =============================================================================
// Report mode authority resolver
// -----------------------------------------------------------------------------
// The plugin-extracted structuredListing.classification.transactionType is
// authoritative for US listings (sourced from /homedetails/* pages). When the
// plugin sets it to a precise "rent" or "sale", it must override the legacy
// body.reportMode / body.listingType / pricePeriod heuristic so we don't end
// up running a sale prompt against a room-rental structured listing (or
// vice-versa).
//
// This file is the single source of truth. It is imported by both
// supabase/functions/analyze/index.ts (the edge handler) and the vitest
// routing test file in src/lib/reportAdapters.
// =============================================================================

const STRUCTURED_LISTING_VALID_SOURCES = new Set(['zillow_structured']);
const STRUCTURED_LISTING_VALID_SOURCE_VERSIONS = new Set(['zillow_structured_v1']);

export function isStructuredListingValid(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const sl = input as Record<string, unknown>;
  if (sl.source !== 'zillow_structured') return false;
  if (typeof sl.sourceVersion !== 'string') return false;
  if (!STRUCTURED_LISTING_VALID_SOURCE_VERSIONS.has(sl.sourceVersion)) return false;

  const identity = sl.identity;
  if (!identity || typeof identity !== 'object') return false;
  const id = identity as Record<string, unknown>;
  if (typeof id.zpid !== 'string' || id.zpid.length === 0) return false;
  if (typeof id.hdpUrl !== 'string' || id.hdpUrl.length === 0) return false;

  const classification = sl.classification;
  if (!classification || typeof classification !== 'object') return false;
  const c = classification as Record<string, unknown>;
  if (typeof c.objectKind !== 'string' || c.objectKind.length === 0) return false;
  if (typeof c.transactionType !== 'string') return false;
  if (typeof c.priceUnit !== 'string' || c.priceUnit.length === 0) return false;

  return true;
}

export function readStructuredTransactionType(body: Record<string, unknown>): 'sale' | 'rent' | null {
  const listingData = (body as Record<string, unknown>).listingData as Record<string, unknown> | undefined;
  const rawStructured = ((body as Record<string, unknown>).structuredListing
    ?? (listingData ? listingData.structuredListing : undefined));
  if (!isStructuredListingValid(rawStructured)) return null;
  const classification = (rawStructured as Record<string, unknown>).classification as Record<string, unknown>;
  const tx = String(classification.transactionType).toLowerCase();
  if (tx === 'sale' || tx === 'rent') return tx;
  return null;
}

export function resolveEffectiveReportMode(
  body: Record<string, unknown>,
  optionalDetails?: Record<string, unknown>,
): 'sale' | 'rent' | 'unknown' {
  // 1) structuredListing.classification.transactionType (highest priority when valid)
  const structuredTx = readStructuredTransactionType(body);
  if (structuredTx === 'sale' || structuredTx === 'rent') return structuredTx;

  // 2) body.reportMode
  if (body.reportMode === 'sale' || body.reportMode === 'rent') return body.reportMode;

  // 3) body.listingType
  if (body.listingType === 'sale' || body.listingType === 'rent') return body.listingType;

  // 4) pricePeriod === "month" implies rent
  const pricePeriodRaw = String(
    (body as Record<string, unknown>).pricePeriod
      ?? optionalDetails?.pricePeriod
      ?? '',
  ).toLowerCase();
  if (pricePeriodRaw === 'month') return 'rent';

  // 5) Otherwise unknown — REPORT_MODE_REQUIRED surfaces in the calling site
  return 'unknown';
}
