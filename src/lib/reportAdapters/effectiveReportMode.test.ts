import { describe, it, expect } from 'vitest';
import {
  isStructuredListingValid,
  readStructuredTransactionType,
  resolveEffectiveReportMode,
} from '../../../supabase/functions/analyze/reportMode';

const ROOM_STRUCTURED_LISTING = {
  source: 'zillow_structured',
  sourceVersion: 'zillow_structured_v1',
  capturedAt: '2026-07-22T15:24:49.784Z',
  capturedPageUrl:
    'https://www.zillow.com/homedetails/1995-S-Logan-St-Denver-CO-80210/58686666_zpid/',
  identity: {
    zpid: '58686666',
    bdpUrl: null,
    hdpUrl: '/homedetails/1995-S-Logan-St-Denver-CO-80210/58686666_zpid/',
    name: null,
    address: '1995 S Logan St, Denver, CO 80210',
  },
  classification: {
    objectKind: 'room',
    transactionType: 'rent',
    priceUnit: 'monthly',
    propertyType: null,
  },
  layout: {
    bedrooms: 1,
    bathrooms: 1,
    sqft: null,
    bedroomRange: null,
    availableUnitCount: null,
  },
  pricing: {
    displayedPrice: 415,
    baseRent: 415,
    priceText: null,
  },
  roomRental: { hasPrivateBath: false, leaseTerm: 'Contact For Details' },
} as const;

const SALE_STRUCTURED_LISTING = {
  ...ROOM_STRUCTURED_LISTING,
  classification: {
    objectKind: 'property',
    transactionType: 'sale',
    priceUnit: 'oneTime',
    propertyType: null,
  },
} as const;

describe('isStructuredListingValid', () => {
  it('accepts a well-formed zillow_structured_v1 payload', () => {
    expect(isStructuredListingValid(ROOM_STRUCTURED_LISTING)).toBe(true);
  });

  it('rejects payloads with the wrong source/sourceVersion', () => {
    expect(
      isStructuredListingValid({ ...ROOM_STRUCTURED_LISTING, source: 'zillow' }),
    ).toBe(false);
    expect(
      isStructuredListingValid({ ...ROOM_STRUCTURED_LISTING, sourceVersion: 'v2' }),
    ).toBe(false);
  });

  it('rejects payloads missing zpid/hdpUrl', () => {
    const { identity, ...rest } = ROOM_STRUCTURED_LISTING;
    expect(isStructuredListingValid({ ...rest, identity: { ...identity, zpid: '' } })).toBe(
      false,
    );
    expect(
      isStructuredListingValid({ ...rest, identity: { ...identity, hdpUrl: '' } }),
    ).toBe(false);
  });

  it('rejects payloads missing classification fields', () => {
    const { classification, ...rest } = ROOM_STRUCTURED_LISTING;
    expect(
      isStructuredListingValid({ ...rest, classification: { ...classification, objectKind: '' } }),
    ).toBe(false);
    expect(
      isStructuredListingValid({
        ...rest,
        classification: { ...classification, priceUnit: '' },
      }),
    ).toBe(false);
  });
});

describe('readStructuredTransactionType', () => {
  it('returns "rent" when the validated payload is rent', () => {
    expect(readStructuredTransactionType({ structuredListing: ROOM_STRUCTURED_LISTING })).toBe(
      'rent',
    );
  });

  it('returns "sale" when the validated payload is sale', () => {
    expect(readStructuredTransactionType({ structuredListing: SALE_STRUCTURED_LISTING })).toBe(
      'sale',
    );
  });

  it('returns null for non-rent/non-sale classified payloads', () => {
    const ambiguous = {
      ...ROOM_STRUCTURED_LISTING,
      classification: { ...ROOM_STRUCTURED_LISTING.classification, transactionType: 'unknown' },
    };
    expect(readStructuredTransactionType({ structuredListing: ambiguous })).toBe(null);
  });

  it('returns null when structuredListing is missing or invalid', () => {
    expect(readStructuredTransactionType({})).toBe(null);
    expect(readStructuredTransactionType({ structuredListing: null })).toBe(null);
    expect(readStructuredTransactionType({ structuredListing: { source: 'zillow' } })).toBe(
      null,
    );
  });
});

describe('resolveEffectiveReportMode priority chain', () => {
  it('A) body.reportMode=sale + structured.rent → rent wins', () => {
    const body = {
      reportMode: 'sale',
      listingType: 'sale',
      structuredListing: ROOM_STRUCTURED_LISTING,
    };
    expect(resolveEffectiveReportMode(body, {})).toBe('rent');
  });

  it('B) body.reportMode=rent + structured.sale → sale wins', () => {
    const body = {
      reportMode: 'rent',
      listingType: 'rent',
      structuredListing: SALE_STRUCTURED_LISTING,
    };
    expect(resolveEffectiveReportMode(body, {})).toBe('sale');
  });

  it('C) structured missing + body.reportMode=rent → rent', () => {
    const body = { reportMode: 'rent' };
    expect(resolveEffectiveReportMode(body, {})).toBe('rent');
  });

  it('D) structured invalid + body.listingType=sale + no body.reportMode → sale', () => {
    // body.reportMode intentionally omitted so the priority chain falls through to body.listingType
    const body = {
      listingType: 'sale',
      structuredListing: { source: 'wrong' },
    };
    expect(resolveEffectiveReportMode(body, {})).toBe('sale');
  });

  it('E) only pricePeriod=month → rent', () => {
    const body = { pricePeriod: 'month' };
    expect(resolveEffectiveReportMode(body, {})).toBe('rent');
  });

  it('F) nothing provided → unknown (REPORT_MODE_REQUIRED surface)', () => {
    expect(resolveEffectiveReportMode({}, {})).toBe('unknown');
    expect(resolveEffectiveReportMode({}, { pricePeriod: 'year' })).toBe('unknown');
  });
});
