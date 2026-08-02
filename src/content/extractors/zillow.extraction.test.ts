/**
 * Phase 1 extraction tests.
 *
 * Covers:
 *   - gdpClientCache zpid filtering
 *   - multi_unit_building extraction
 *   - selected_unit extraction
 *   - private_room detection
 *   - SPA cross-building pollution
 */

import { describe, expect, it } from 'vitest';
import { ZillowExtractor } from './zillow';
import type { ExtractContext } from './base';
import {
  FIXTURE_SALE_SINGLE,
  FIXTURE_RENT_ENTIRE,
  FIXTURE_RENT_PRIVATE_ROOM,
  FIXTURE_MULTI_UNIT_BUILDING,
  FIXTURE_SELECTED_UNIT,
  FIXTURE_GDP_POLLUTION,
  FIXTURE_SPA_BUILDING_TRANSITION,
  FIXTURE_GDP_CACHE_KEY_BUT_PROPERTY_ZPID_MISMATCH,
  FIXTURE_ENTIRE_HOME_WITH_WEAK_PHRASES,
  FIXTURE_STUDIO_SELECTED_UNIT,
  type ExtractionFixture,
} from './__fixtures__/zillow.phase1';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildMockDoc(fx: ExtractionFixture): Document {
  // Compose body text for private room detection fallback
  let bodyText = '';
  if (fx.rawDescription) bodyText += fx.rawDescription + '\n';
  if (fx.rawWhatsSpecial) bodyText += fx.rawWhatsSpecial + '\n';

  // Inject description / whatsSpecialText into the first matching gdpClientCache entry
  // so that extractFromPropertyData picks it up into raw.description / raw.whatsSpecialText.
  let nextData = fx.nextData ?? '{}';
  if (fx.rawDescription || fx.rawWhatsSpecial || fx.listingSubType) {
    try {
      const parsed = JSON.parse(nextData);
      const cache = parsed?.props?.pageProps?.componentProps?.gdpClientCache;
      if (cache && typeof cache === 'object') {
        for (const key of Object.keys(cache)) {
          const entry = cache[key];
          if (entry && typeof entry === 'object') {
            if (fx.rawDescription) entry.description = fx.rawDescription;
            if (fx.rawWhatsSpecial) entry.whatsSpecialText = fx.rawWhatsSpecial;
            if (fx.listingSubType) entry.listingSubType = fx.listingSubType;
          }
        }
      }
      nextData = JSON.stringify(parsed);
    } catch {
      // ignore — fall through to raw nextData
    }
  }

  const doc = {
    URL: fx.url,
    querySelector: (sel: string) => {
      if (sel === 'script[id="__NEXT_DATA__"]') {
        return {
          textContent: nextData,
        };
      }
      // Allow description/whatsSpecial to be found via h1 / data-testid
      if (sel === 'h1' && fx.rawDescription) {
        return { textContent: fx.rawDescription };
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel === 'script[type="application/ld+json"]') {
        if (fx.jsonLdScripts) {
          return fx.jsonLdScripts.map(s => ({ textContent: s }));
        }
        return [];
      }
      return [];
    },
    body: {
      textContent: bodyText,
      innerText: bodyText,
      innerHTML: bodyText,
      querySelector: (_sel: string) => null,
    },
  } as unknown as Document;

  return doc;
}

function makeCtx(fx: ExtractionFixture): ExtractContext {
  const doc = buildMockDoc(fx);
  return {
    document: doc,
    url: new URL(fx.url),
    signals: {} as ExtractContext['signals'],
    stage: 'final',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// canHandle
// ─────────────────────────────────────────────────────────────────────────────

describe('canHandle', () => {
  const ext = new ZillowExtractor();

  const cases: Array<{ url: string; expected: boolean; note: string }> = [
    { url: 'https://www.zillow.com/homedetails/123-St/111_zpid/', expected: true, note: 'homedetails (single sale)' },
    { url: 'https://www.zillow.com/condo/123-St/111_zpid/', expected: true, note: 'condo detail page' },
    { url: 'https://www.zillow.com/townhouse/123-St/111_zpid/', expected: true, note: 'townhouse detail page' },
    { url: 'https://www.zillow.com/rent/123-St/111_zpid/', expected: true, note: 'rent detail page' },
    { url: 'https://www.zillow.com/lot/123-St/111_zpid/', expected: true, note: 'lot detail page' },
    // Phase 1 new routes
    { url: 'https://www.zillow.com/apartments/los-angeles-ca/urbanlux/5YsP4L/', expected: true, note: 'multi-unit building overview' },
    { url: 'https://www.zillow.com/b/CgzFQT/', expected: true, note: '/b/ building shorthand' },
    { url: 'https://www.zillow.com/apartments/los-angeles-ca/urbanlux/5YsP4L/1234567890_zpid/', expected: true, note: 'selected unit inside a building' },
    // Unsupported
    { url: 'https://www.zillow.com/search/los-angeles-ca/', expected: false, note: 'search results page must be REJECTED' },
    { url: 'https://www.zillow.com/homes/', expected: false, note: 'homes index must be REJECTED' },
    { url: 'https://example.com/homedetails/123-St/111_zpid/', expected: false, note: 'off-domain must be REJECTED' },
  ];

  for (const { url, expected, note } of cases) {
    it(`${expected ? 'accepts' : 'rejects'} ${url} — ${note}`, () => {
      expect(ext.canHandle(new URL(url))).toBe(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// canHandle + scope derivation
// ─────────────────────────────────────────────────────────────────────────────

describe('listingScope derivation', () => {
  it('sale single-property: listingScope = single_property', async () => {
    const ctx = makeCtx(FIXTURE_SALE_SINGLE);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    expect(data.listingScope).toBe('single_property');
    expect(data.listingType).toBe('sale');
  });

  it('entire_home rent: listingScope = entire_home', async () => {
    const ctx = makeCtx(FIXTURE_RENT_ENTIRE);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    expect(data.listingScope).toBe('entire_home');
    expect(data.listingType).toBe('rent');
    expect(data.monthlyRent).toBe(3800);
  });

  it('private_room: listingScope = private_room', async () => {
    const ctx = makeCtx(FIXTURE_RENT_PRIVATE_ROOM);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    expect(data.listingScope).toBe('private_room');
    expect(data.listingType).toBe('rent');
  });

  it('multi_unit_building: listingScope = multi_unit_building, no spurious monthlyRent', async () => {
    const ctx = makeCtx(FIXTURE_MULTI_UNIT_BUILDING);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    expect(data.listingScope).toBe('multi_unit_building');
    expect(data.listingType).toBe('rent');
    expect(data.buildingName).toBe('Urbanlux Sunset Premium');
    expect(data.availableUnits).toBeDefined();
    expect(data.availableUnits?.length).toBe(5);
    // Must NOT have a single monthlyRent (would be fake)
    expect(data.monthlyRent).toBeNull();
    expect(data.bedrooms).toBeNull();
    expect(data.bathrooms).toBeNull();
    expect(data.sqft).toBeNull();
  });

  it('selected_unit: listingScope = selected_unit, price from matched unit', async () => {
    const ctx = makeCtx(FIXTURE_SELECTED_UNIT);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    expect(data.listingScope).toBe('selected_unit');
    expect(data.listingType).toBe('rent');
    expect(data.buildingName).toBe('Urbanlux Sunset Premium');
    expect(data.monthlyRent).toBe(2900);
    expect(data.availableUnits?.length).toBe(1);
  });

  it('gdpClientCache pollution: wrong zpid entry must be rejected', async () => {
    const ctx = makeCtx(FIXTURE_GDP_POLLUTION);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    // No matching zpid entry → extraction should fall through to unknown
    expect(data.listingType).toBe('unknown');
  });

  it('SPA cross-building: stale gdp.building with mismatched buildingId → unavailable', async () => {
    const ctx = makeCtx(FIXTURE_SPA_BUILDING_TRANSITION);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    // Building ID in gdp doesn't match URL → no valid extraction
    expect(data.listingType).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gdpClientCache zpid filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('gdpClientCache zpid filtering', () => {
  it('only accepts entry matching current URL zpid', async () => {
    const ctx = makeCtx(FIXTURE_SALE_SINGLE);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    // Must NOT contain stale address "STALE ADDRESS WRONG"
    expect(data.address).not.toContain('STALE');
    expect(data.address).toContain('1425');
  });

  it('rejects entries whose cache key has no zpid but entry.property.zpid is a different listing', async () => {
    // Cache key is "some_other_property" / "yet_another_property" (no `<digits>_zpid` shape);
    // entry.property.zpid / entry.zpid is 1111111111 / 2222222222 — different from URL zpid 777777777.
    // Both the entry-level truth and the URL agree these are NOT this page,
    // so address / price / beds / baths / sqft must NOT carry those polluted numbers.
    const ctx = makeCtx(FIXTURE_GDP_CACHE_KEY_BUT_PROPERTY_ZPID_MISMATCH);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    const address = (data as { address?: string }).address ?? '';
    expect(address).not.toContain('POLLUTED');
    // Polluted entries carried price=900/1500, bedrooms=1/2. None may survive.
    const price = (data as { price?: number | string | null }).price;
    const beds = (data as { bedrooms?: number | string | null }).bedrooms;
    const baths = (data as { bathrooms?: number | string | null }).bathrooms;
    const sqft = (data as { sqft?: number | string | null }).sqft;
    const isEmpty = (v: unknown) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
    expect(isEmpty(price)).toBe(true);
    expect(isEmpty(beds)).toBe(true);
    expect(isEmpty(baths)).toBe(true);
    expect(isEmpty(sqft)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// private room strong signals
// ─────────────────────────────────────────────────────────────────────────────

describe('private room detection', () => {
  it('detects "room for rent" in description', async () => {
    const ctx = makeCtx(FIXTURE_RENT_PRIVATE_ROOM);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    expect(data.listingScope).toBe('private_room');
  });

  it('does NOT misclassify entire home as private_room (no signal)', async () => {
    const ctx = makeCtx(FIXTURE_RENT_ENTIRE);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    expect(data.listingScope).toBe('entire_home');
  });

  it('does NOT misclassify when description contains weak phrasings only (second-floor / shared bathroom)', async () => {
    // "second-floor bedrooms" + "shared bathroom" + "available to rent as a single unit only"
    // — these MUST NOT trigger private_room. Description also contains
    // "entire home" / "whole apartment" to enforce the ENTIRE_HOME path.
    const ctx = makeCtx(FIXTURE_ENTIRE_HOME_WITH_WEAK_PHRASES);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    expect(data.listingScope).toBe('entire_home');
    expect(data.listingType).toBe('rent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// multi_unit_building does not produce fake fields
// ─────────────────────────────────────────────────────────────────────────────

describe('multi_unit_building field integrity', () => {
  it('does not set single monthlyRent / bedrooms / sqft on building pages', async () => {
    const ctx = makeCtx(FIXTURE_MULTI_UNIT_BUILDING);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    // All unit-specific fields must be absent or null
    expect(data.monthlyRent ?? null).toBeNull();
    expect(data.bedrooms ?? null).toBeNull();
    expect(data.bathrooms ?? null).toBeNull();
    expect(data.sqft ?? null).toBeNull();
    // Building-level fields must be present
    expect(data.buildingName).toBe('Urbanlux Sunset Premium');
    expect(data.availableUnits?.length ?? 0).toBeGreaterThan(0);
  });

  it('availableUnits contains correct unit count', async () => {
    const ctx = makeCtx(FIXTURE_MULTI_UNIT_BUILDING);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    const units = data.availableUnits ?? [];
    // 2 studio + 2 one-br + 1 two-br = 5
    expect(units.length).toBe(5);
    // Each unit has a price
    for (const u of units) {
      expect(u.monthlyRent).not.toBeNull();
    }
    // Check a specific unit
    const unit201 = units.find(u => u.name === 'Unit 201');
    expect(unit201?.monthlyRent).toBe(2900);
    expect(unit201?.bedrooms).toBe(1);
    expect(unit201?.availableFrom).toBe('2026-09-15');
  });

  it('keeps two units with identical beds/baths/sqft/price but distinct unitNumbers', async () => {
    // Property-level: a building with two 1br units, same plan, same price,
    // different unit numbers. They MUST stay as TWO separate availableUnits
    // entries (correct semantic), not be merged.
    const fixture: ExtractionFixture = {
      url: 'https://www.zillow.com/apartments/los-angeles-ca/duplicate-plan/DupPlan/',
      description: 'Two identical 1br units, different unit numbers',
      nextData: JSON.stringify({
        props: {
          pageProps: {
            componentProps: {
              initialReduxState: {
                gdp: {
                  building: {
                    buildingId: 'DupPlan',
                    buildingName: 'Dup Plan Building',
                    streetAddress: '50 Spring St',
                    city: 'Los Angeles',
                    state: 'CA',
                    zipcode: '90013',
                    floorPlans: [
                      {
                        name: '1 Bedroom',
                        beds: 1,
                        baths: 1,
                        sqft: 700,
                        minPrice: 2700,
                        maxPrice: 2700,
                        units: [
                          { unitId: 'AA100', name: 'Unit 100', unitNumber: '100', beds: 1, baths: 1, sqft: 700, price: 2700, availableFrom: '2026-09-01' },
                          { unitId: 'AA101', name: 'Unit 101', unitNumber: '101', beds: 1, baths: 1, sqft: 700, price: 2700, availableFrom: '2026-09-01' },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      }),
      expectedListingScope: 'multi_unit_building',
      expectedListingType: 'rent',
      expectedBuildingName: 'Dup Plan Building',
      expectedAvailableUnitsCount: 2,
      expectUnavailable: false,
    };
    const ctx = makeCtx(fixture);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    const units = data.availableUnits ?? [];
    expect(units.length).toBe(2);

    const u100 = units.find((u) => u.unitNumber === '100' || u.unitId === 'AA100');
    const u101 = units.find((u) => u.unitNumber === '101' || u.unitId === 'AA101');
    expect(u100).toBeTruthy();
    expect(u101).toBeTruthy();
    expect(u100?.unitId).not.toEqual(u101?.unitId);
  });

  it('separates availableUnits from floorPlanSummaries so the two semantics cannot be conflated', async () => {
    const ctx = makeCtx(FIXTURE_MULTI_UNIT_BUILDING);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    // availableUnits: 5 entries (one per concrete unit)
    expect((data.availableUnits ?? []).length).toBe(5);
    // floorPlanSummaries: 3 entries (Studio / 1BR / 2BR) — different count
    expect((data.floorPlanSummaries ?? []).length).toBe(3);
    // floorPlanSummaries must NOT carry per-unit rent; they carry roll-ups
    const studioSummary = (data.floorPlanSummaries ?? []).find((s) => s.planName === 'Studio');
    expect(studioSummary?.bedrooms).toBe(0);
    expect(studioSummary?.unitCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Studio (bedrooms=0) selected_unit — real-page regression
// 725 N Logan St APT 5 / Governor's Park West / 2097740413
//
// description body includes the noise phrase
//   "spacious studios and thoughtfully designed one-bedroom apartments"
// which previously caused a permissive body-text regex to overwrite the
// structured 0 with 1.
// ─────────────────────────────────────────────────────────────────────────────
describe('studio bedrooms=0 — must NOT be flipped by description noise', () => {
  it('keeps bedrooms=0 even though description mentions "one-bedroom apartments"', async () => {
    const ctx = makeCtx(FIXTURE_STUDIO_SELECTED_UNIT);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    // rent type from structured source
    expect(data.listingType).toBe('rent');
    // CRITICAL: structured bedrooms=0 must NOT be flipped to 1
    expect(data.bedrooms).toBe(0);
    // bathrooms and sqft from structured source
    expect(data.bathrooms).toBe(1);
    expect(data.sqft).toBe(230);
  });

  it('keeps sqft=230 even when no body fallback fires', async () => {
    const ctx = makeCtx(FIXTURE_STUDIO_SELECTED_UNIT);
    const ext = new ZillowExtractor();
    const data = await ext.extract(ctx);
    // The fixture sets gdpClientCache.livingArea=230 → sqft. The DOM bed-bath
    // test-id path is NOT exercised in this mock. We require that the value
    // survives even when no DOM fallback ran.
    expect(data.sqft).toBe(230);
  });
});
