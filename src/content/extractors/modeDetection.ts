/**
 * Listing-mode detection (PR 1A).
 *
 * Replaces the previous chain of
 *   detectHardTruthFromBody → detectFromStructuredData → detectFromTargetedDom
 * with three explicit, independent sources joined by a deterministic resolver:
 *
 *   Source A (JSON-LD) — highest quality, but only counts when the JSON-LD node
 *                       actually belongs to the current listing (zpid / pathname
 *                       match). Near-list nodes (ItemList of nearby homes) MUST
 *                       be filtered out.
 *   Source B (structured raw status) — reads the *original* `homeStatus` /
 *                       `listingType` / `listing_sub_type` / `transactionType`
 *                       from the gdpClientCache for the current zpid ONLY.
 *                       Uses exact enum matching; sale+rent → conflict.
 *   Source C (Hero DOM) — current-listing-only DOM signals. Explicit status
 *                       text (`For sale` / `For rent` / `Room for rent`) can
 *                       stand alone. Price-only signals must be paired with a
 *                       second current-listing CTA.
 *
 * Resolver never uses document.body.innerText and never fuzzy-matches a
 * `SALE|RENT` regex on concatenated fields.
 *
 * Price mapping (askingPrice vs monthlyRent) happens AFTER the mode is fixed,
 * so the wrong-mode branch can never leak into the other side's typed fields.
 */

import {
  LISTING_MODE_EVIDENCE_VALUES,
  LISTING_MODE_RESOLVER_VERSION,
  type ListingMode,
  type ListingModeResolution,
  type ListingModeSourceResult,
} from './types';
import { normalizePath } from './urlUtils';

type JsonLdItem = Record<string, unknown>;

export interface JsonLdSourceResult {
  source: 'jsonld';
  mode: ListingModeSourceResult;
  evidence: string[];
}

export interface StructuredSourceInput {
  homeStatus?: string | undefined;
  listingType?: string | undefined;
  listingSubType?: string | undefined;
  transactionType?: string | undefined;
}

export interface StructuredSourceResult {
  source: 'structured';
  mode: ListingModeSourceResult;
  evidence: string[];
}

export interface HeroSourceResult {
  source: 'hero';
  mode: ListingModeSourceResult;
  evidence: string[];
}

export interface ResolverSources {
  jsonLd: JsonLdSourceResult;
  structured: StructuredSourceResult;
  hero: HeroSourceResult;
  url: string;
}

const SALE_EVIDENCE = 'jsonld_sell';
const RENT_EVIDENCE = 'jsonld_leaseout';

// ============================================================================
// Source A — JSON-LD businessFunction
// ============================================================================

function pickType(item: JsonLdItem): string[] {
  const t = item['@type'];
  if (Array.isArray(t)) return t.map((x) => String(x).toLowerCase());
  return [String(t ?? '').toLowerCase()];
}

function isRealEstateListing(item: JsonLdItem): boolean {
  return pickType(item).some((t) => t.includes('realestatelisting') || t === 'realestate');
}

function itemZpid(item: JsonLdItem): string | null {
  const fromZpid = item.zpid;
  if (fromZpid != null) return String(fromZpid);
  const fromId = item.identifier;
  if (typeof fromId === 'string') return fromId;
  if (fromId && typeof fromId === 'object') {
    const v = (fromId as Record<string, unknown>).value;
    if (v != null) return String(v);
  }
  for (const k of ['url', '@id', 'hdpUrl'] as const) {
    const v = item[k];
    if (typeof v === 'string') {
      const m = v.match(/\/(\d+)_zpid\//);
      if (m) return m[1];
    }
  }
  return null;
}

function isCurrentListingItem(item: JsonLdItem, ctx: {
  url: URL;
  zpid: string | null;
  currentPathname: string;
}): boolean {
  // 1. zpid match (preferred)
  const z = itemZpid(item);
  if (ctx.zpid && z && ctx.zpid === z) return true;

  // 2. pathname match (lower-cased, normalized)
  for (const k of ['url', '@id', 'hdpUrl'] as const) {
    const v = item[k];
    if (typeof v !== 'string') continue;
    try {
      const parsed = new URL(v, ctx.url.href);
      const path = normalizePath(parsed.href);
      if (path && path === ctx.currentPathname) return true;
    } catch {
      // ignore malformed
    }
  }
  return false;
}

function normalizeBusinessFunction(v: unknown): 'sell' | 'leaseout' | null {
  if (v == null) return null;
  const s = typeof v === 'object' ? String((v as Record<string, unknown>)['@id'] ?? '') : String(v);
  const lower = s.toLowerCase();
  if (lower.endsWith('#sell') || lower === 'sell') return 'sell';
  if (lower.endsWith('#leaseout') || lower === 'leaseout') return 'leaseout';
  return null;
}

export function resolveModeFromCurrentListingJsonLd(
  doc: Document,
  ctx: { url: URL; zpid: string | null; currentPathname: string },
): JsonLdSourceResult {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent || '');
    } catch {
      continue;
    }
    const candidates: JsonLdItem[] = Array.isArray(data)
      ? (data as JsonLdItem[])
      : data && Array.isArray((data as Record<string, unknown>)['@graph'])
        ? ((data as Record<string, unknown>)['@graph'] as JsonLdItem[])
        : [data as JsonLdItem];

    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;
      if (!isRealEstateListing(item)) continue;
      if (!isCurrentListingItem(item, ctx)) continue;

      const offersRaw = item.offers;
      const offers = Array.isArray(offersRaw)
        ? (offersRaw as unknown[])
        : offersRaw != null
          ? [offersRaw]
          : [];
      const funcs = offers
        .map(normalizeBusinessFunction)
        .filter((v): v is 'sell' | 'leaseout' => v !== null);

      if (funcs.length === 0) {
        // Look for MON unit as a secondary hint, but it must not stand alone.
        const evidence: string[] = ['jsonld_missing_business_function'];
        for (const offer of offers) {
          if (!offer || typeof offer !== 'object') continue;
          const spec = (offer as Record<string, unknown>).priceSpecification;
          if (spec && typeof spec === 'object') {
            const elig = (spec as Record<string, unknown>).eligibleQuantity;
            if (elig && typeof elig === 'object') {
              const unit = String((elig as Record<string, unknown>).unitCode ?? '').toUpperCase();
              if (unit === 'MON') evidence.push('jsonld_mon_unit');
            }
          }
        }
        return { source: 'jsonld', mode: 'none', evidence };
      }

      const first = funcs[0];
      if (funcs.every((f) => f === first)) {
        const mode: ListingMode = first === 'sell' ? 'sale' : 'rent';
        const evidence = [mode === 'sale' ? SALE_EVIDENCE : RENT_EVIDENCE];
        for (const offer of offers) {
          if (!offer || typeof offer !== 'object') continue;
          const spec = (offer as Record<string, unknown>).priceSpecification;
          if (spec && typeof spec === 'object') {
            const elig = (spec as Record<string, unknown>).eligibleQuantity;
            if (elig && typeof elig === 'object') {
              const unit = String((elig as Record<string, unknown>).unitCode ?? '').toUpperCase();
              if (unit === 'MON') evidence.push('jsonld_mon_unit');
            }
          }
        }
        return { source: 'jsonld', mode, evidence };
      }

      return {
        source: 'jsonld',
        mode: 'conflict',
        evidence: ['jsonld_conflict', ...funcs.map((f) => (f === 'sell' ? SALE_EVIDENCE : RENT_EVIDENCE))],
      };
    }
  }
  return { source: 'jsonld', mode: 'none', evidence: [] };
}

// ============================================================================
// Source B — structured raw status (Zillow original fields, current zpid only)
// ============================================================================

const SALE_HOME_STATUS = new Set(['FOR_SALE', 'SALE', 'SOLD']);
const RENT_HOME_STATUS = new Set(['FOR_RENT', 'RENT']);
const FOR_SALE_SUBS = new Set(['FOR_SALE', 'SALE']);
const FOR_RENT_SUBS = new Set(['FOR_RENT', 'RENT']);

function upper(v: string | undefined): string {
  return String(v ?? '').toUpperCase();
}

export function resolveStructuredRawStatus(raw: StructuredSourceInput): StructuredSourceResult {
  const home = upper(raw.homeStatus);
  const lt = upper(raw.listingType);
  const sub = upper(raw.listingSubType);
  const tx = upper(raw.transactionType);

  let sale = false;
  let rent = false;

  if (SALE_HOME_STATUS.has(home)) sale = true;
  if (RENT_HOME_STATUS.has(home)) rent = true;
  if (FOR_SALE_SUBS.has(lt)) sale = true;
  if (FOR_RENT_SUBS.has(lt)) rent = true;
  if (FOR_SALE_SUBS.has(sub)) sale = true;
  if (FOR_RENT_SUBS.has(sub)) rent = true;
  if (FOR_SALE_SUBS.has(tx)) sale = true;
  if (FOR_RENT_SUBS.has(tx)) rent = true;

  if (sale && rent) {
    return { source: 'structured', mode: 'conflict', evidence: ['structured_conflict'] };
  }
  if (sale) {
    return { source: 'structured', mode: 'sale', evidence: ['structured_for_sale'] };
  }
  if (rent) {
    return { source: 'structured', mode: 'rent', evidence: ['structured_for_rent'] };
  }
  return { source: 'structured', mode: 'none', evidence: ['structured_missing'] };
}

// ============================================================================
// Source C — current-listing Hero DOM
// ----------------------------------------------------------------------------
// DOM access is restricted to data-testid selectors on the *current* listing.
// Never reads document.body.innerText; never scans global matches.
// ============================================================================

function getText(node: Element | null | undefined): string {
  if (!node) return '';
  return (node.textContent || '').trim().toLowerCase();
}

const STATUS_NODE_SELECTORS = ['[data-testid="status"]', '[class*="status-message"]'];
const PRICE_NODE_SELECTORS = [
  '[data-testid="price"]',
  '[data-testid="list-price"]',
  '[class*="ListPrice"]',
  'h3[class*="price"]',
];

function queryFirst(doc: Document, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const RENT_CTA = /\bapply\s*now\b|\brequest\s*to\s*apply\b|\bavailable\s*units\b|\blease\s*details\b/i;
const SALE_CTA = /\bmake\s*an?\s*offer\b|\bget\s*pre-?qualified\b|\bbuyer'?s?\s*agent\b/i;
const MONTHLY_UNIT = /\/(?:mo|month|monthly)\b/;

/**
 * Lightweight DOM view used by the Hero resolver. Defaulting to a Document
 * keeps the production call-site ergonomic; tests pass a stub via the
 * second argument.
 */
export interface HeroQuery {
  readonly statusText: string;
  readonly h1Text: string;
  readonly priceText: string;
  readonly ctas: string[];
}

export function resolveModeFromCurrentListingHero(
  doc: Document,
  override?: HeroQuery,
): HeroSourceResult {
  const view: HeroQuery = override ?? readHeroFromDocument(doc);
  return heroFromView(view);
}

function readHeroFromDocument(doc: Document): HeroQuery {
  return {
    statusText: getText(queryFirst(doc, STATUS_NODE_SELECTORS)),
    h1Text: getText(doc.querySelector('h1')),
    priceText: getText(queryFirst(doc, PRICE_NODE_SELECTORS)),
    ctas: collectCurrentListingCtas(doc),
  };
}

function heroFromView(view: HeroQuery): HeroSourceResult {
  const { statusText, h1Text, priceText, ctas } = view;
  // Normalize to lowercase to mirror what getText() would have produced from
  // an Element.textContent read in production.
  const status = statusText.trim().toLowerCase();
  const h1 = h1Text.trim().toLowerCase();
  const price = priceText.trim().toLowerCase();

  // 1) Explicit status node — can stand alone.
  if (/^\s*(for\s*rent|room\s*for\s*rent)\s*$/.test(status)) {
    return {
      source: 'hero',
      mode: 'rent',
      evidence: status.includes('room')
        ? ['hero_status_room_for_rent']
        : ['hero_status_for_rent'],
    };
  }
  if (/^\s*(for\s*sale|sale)\s*$/.test(status)) {
    return { source: 'hero', mode: 'sale', evidence: ['hero_status_for_sale'] };
  }

  // 2) h1 — independent confirmation only when unambiguous.
  if (/room\s*for\s*rent/.test(h1) && !/for\s*sale/.test(h1)) {
    return { source: 'hero', mode: 'rent', evidence: ['hero_status_room_for_rent'] };
  }
  if (/for\s*rent/.test(h1) && !/for\s*sale/.test(h1)) {
    return { source: 'hero', mode: 'rent', evidence: ['hero_status_for_rent'] };
  }
  if (/for\s*sale/.test(h1) && !/for\s*rent/.test(h1)) {
    return { source: 'hero', mode: 'sale', evidence: ['hero_status_for_sale'] };
  }

  // 3) Price-only path — MUST be paired with a current-listing CTA. Never
  //    trust a price chip in isolation; the Sale HDP shows $6,600/mo in
  //    "Est. payment" (BuyAbility) which would otherwise flip it to rent.
  const hasMonthlyPrice = MONTHLY_UNIT.test(price);
  const hasTotalPrice = price.length > 0 && !hasMonthlyPrice;
  const hasRentCta = ctas.some((s) => RENT_CTA.test(s));
  const hasSaleCta = ctas.some((s) => SALE_CTA.test(s));

  // 3a) Conflicting CTAs combined with a price → return none (no majority vote).
  if (price.length > 0 && hasRentCta && hasSaleCta) {
    return { source: 'hero', mode: 'none', evidence: ['hero_conflicting_ctas'] };
  }

  if (hasMonthlyPrice && hasRentCta) {
    return { source: 'hero', mode: 'rent', evidence: ['hero_price_monthly_with_rent_cta'] };
  }
  if (hasTotalPrice && hasSaleCta) {
    return { source: 'hero', mode: 'sale', evidence: ['hero_price_total_with_sale_cta'] };
  }

  // 4) Nothing matched — explicit, no guess.
  if (price.length > 0) {
    return { source: 'hero', mode: 'none', evidence: ['hero_price_only_no_status'] };
  }
  return { source: 'hero', mode: 'none', evidence: [] };
}

function collectCurrentListingCtas(doc: Document): string[] {
  const out: string[] = [];
  // CTAs in the listing hero are usually inside the action bar; for safety
  // we scan both anchors with role="button" and visible button elements,
  // restricted to the first 200 elements (hero scope) rather than document.all.
  const nodes = doc.querySelectorAll(
    'button, a[role="button"], a[class*="Button"], [role="button"]',
  );
  const cap = Math.min(nodes.length, 200);
  for (let i = 0; i < cap; i++) {
    const el = nodes.item(i);
    const txt = (el.textContent || '').trim();
    if (txt) out.push(txt);
  }
  return out;
}

// ============================================================================
// Resolver
// ----------------------------------------------------------------------------
// Deterministic, no majority voting. Quality hierarchy:
//   1. JSON-LD businessFunction (when item matches current listing)
//   2. structuredRawStatus    (when source matches current zpid)
//   3. Hero DOM               (medium quality — needs second signal for price-only)
//   4. URL fallback           (rent-only, low quality)
// A single high-quality source can stand alone only when Hero agrees or is none.
// ============================================================================

const RENT_URL_TOKENS = ['/rent', '/for-rent', '/rental', '/apartments', '/community'];

function isRentUrl(normPath: string): boolean {
  return RENT_URL_TOKENS.some((tok) => normPath.includes(tok));
}

function mkResolution(args: {
  mode: ListingMode;
  confidence: 'high' | 'medium' | 'low';
  decisionSource: ListingModeResolution['decisionSource'];
  conflict: boolean;
  sources: ResolverSources;
  extraEvidence?: string[];
}): ListingModeResolution {
  const seen = new Set<string>();
  const evidence: string[] = [];
  const collect = (e: string) => {
    if (!seen.has(e) && LISTING_MODE_EVIDENCE_VALUES.has(e)) {
      seen.add(e);
      evidence.push(e);
    }
  };
  for (const src of [args.sources.jsonLd, args.sources.structured, args.sources.hero]) {
    for (const e of src.evidence) collect(e);
  }
  if (args.extraEvidence) for (const e of args.extraEvidence) collect(e);

  return {
    resolverVersion: LISTING_MODE_RESOLVER_VERSION,
    mode: args.mode,
    confidence: args.confidence,
    decisionSource: args.decisionSource,
    conflict: args.conflict,
    evidence,
    sources: {
      jsonLd: args.sources.jsonLd.mode,
      structured: args.sources.structured.mode,
      hero: args.sources.hero.mode,
    },
    listingIdentity: '',
  };
}

export function resolveListingMode(sources: ResolverSources): ListingModeResolution {
  const { jsonLd, structured, hero } = sources;
  const anyConflict =
    jsonLd.mode === 'conflict' ||
    structured.mode === 'conflict' ||
    hero.mode === 'conflict';

  const highModes: ListingMode[] = [];
  if (jsonLd.mode === 'sale' || jsonLd.mode === 'rent') highModes.push(jsonLd.mode);
  if (structured.mode === 'sale' || structured.mode === 'rent') highModes.push(structured.mode);

  // Case 1: both high-quality sources agree — but only if Hero does not
  // contradict them. Hero is medium-quality; it cannot have a vote when it
  // agrees, but it CAN veto when it disagrees with both high-quality sources.
  // Any source reporting 'conflict' is also a veto.
  if (highModes.length === 2 && highModes[0] === highModes[1]) {
    if (anyConflict) {
      return mkResolution({
        mode: 'unknown',
        confidence: 'low',
        decisionSource: 'conflict',
        conflict: true,
        sources,
        extraEvidence: ['conflict_in_sources'],
      });
    }
    if (hero.mode === 'sale' || hero.mode === 'rent') {
      if (hero.mode !== highModes[0]) {
        return mkResolution({
          mode: 'unknown',
          confidence: 'low',
          decisionSource: 'conflict',
          conflict: true,
          sources,
          extraEvidence: ['conflict_high_vs_medium_inverse'],
        });
      }
      return mkResolution({
        mode: highModes[0],
        confidence: 'high',
        decisionSource: 'source_consensus',
        conflict: false,
        sources,
        extraEvidence: ['jsonld_consensus_with_structured'],
      });
    }
    return mkResolution({
      mode: highModes[0],
      confidence: 'high',
      decisionSource: 'source_consensus',
      conflict: false,
      sources,
      extraEvidence: ['jsonld_consensus_with_structured'],
    });
  }
  // Case 2: both high-quality sources disagree.
  if (highModes.length === 2 && highModes[0] !== highModes[1]) {
    return mkResolution({
      mode: 'unknown',
      confidence: 'low',
      decisionSource: 'conflict',
      conflict: true,
      sources,
    });
  }

  // Case 3: exactly one high-quality source.
  const singleHigh = highModes[0];
  if (singleHigh) {
    // Any source in conflict must veto any single high-quality vote.
    if (anyConflict) {
      return mkResolution({
        mode: 'unknown',
        confidence: 'low',
        decisionSource: 'conflict',
        conflict: true,
        sources,
      });
    }
    if (hero.mode === singleHigh) {
      return mkResolution({
        mode: singleHigh,
        confidence: 'high',
        decisionSource: 'source_consensus',
        conflict: false,
        sources,
        extraEvidence: ['jsonld_consensus_with_structured'],
      });
    }
    if (hero.mode === 'sale' || hero.mode === 'rent') {
      // High quality contradicts medium quality — do NOT majority-vote.
      return mkResolution({
        mode: 'unknown',
        confidence: 'low',
        decisionSource: 'conflict',
        conflict: true,
        sources,
        extraEvidence: ['conflict_high_vs_medium'],
      });
    }
    return mkResolution({
      mode: singleHigh,
      confidence: 'high',
      decisionSource: 'jsonld_business_function',
      conflict: false,
      sources,
      extraEvidence: ['jsonld_alone'],
    });
  }

  // Case 4: only Hero has a result.
  if (hero.mode === 'sale' || hero.mode === 'rent') {
    return mkResolution({
      mode: hero.mode,
      confidence: 'medium',
      decisionSource: 'current_listing_hero',
      conflict: anyConflict,
      sources,
      extraEvidence: ['hero_alone'],
    });
  }

  // Case 5: URL fallback (rent only).
  const norm = normalizePath(sources.url);
  if (norm && isRentUrl(norm)) {
    return mkResolution({
      mode: 'rent',
      confidence: 'low',
      decisionSource: 'rent_url_fallback',
      conflict: anyConflict,
      sources,
      extraEvidence: ['url_rent_path'],
    });
  }

  // Case 6: no evidence.
  return mkResolution({
    mode: 'unknown',
    confidence: 'low',
    decisionSource: 'insufficient_evidence',
    conflict: anyConflict,
    sources,
  });
}

// ============================================================================
// Price mapping
// ----------------------------------------------------------------------------
// After the mode is fixed, askingPrice and monthlyRent are populated
// exclusively on their own side; rawFacts carries a curated subset of common
// data so we don't replicate the full common blob into the request body.
// ============================================================================

export interface PriceMappingInput {
  displayedPrice?: string | undefined;
  askingPrice?: number | null | undefined;
  monthlyRent?: number | null | undefined;
  description?: string | undefined;
  title?: string | undefined;
}

export interface PriceMappingResult {
  mode: ListingMode;
  askingPrice?: number | null;
  monthlyRent?: number | null;
  pricePeriod: 'week' | 'month' | 'year' | 'total' | 'unknown';
  displayedPrice?: string;
  rawFacts: {
    description?: string;
    listingStatusText?: string;
    primaryPriceText?: string;
  };
}

export function mapPriceAfterMode(mode: ListingMode, input: PriceMappingInput): PriceMappingResult {
  const rawFacts = {
    description: input.description,
    listingStatusText: input.title,
    primaryPriceText: input.displayedPrice,
  };
  if (mode === 'sale') {
    return {
      mode: 'sale',
      askingPrice: input.askingPrice ?? undefined,
      pricePeriod: 'total',
      displayedPrice: input.displayedPrice,
      rawFacts,
    };
  }
  if (mode === 'rent') {
    return {
      mode: 'rent',
      monthlyRent: input.monthlyRent ?? undefined,
      pricePeriod: 'month',
      displayedPrice: input.displayedPrice,
      rawFacts,
    };
  }
  return {
    mode: 'unknown',
    pricePeriod: 'unknown',
    displayedPrice: input.displayedPrice,
    rawFacts,
  };
}