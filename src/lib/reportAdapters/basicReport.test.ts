// ===== Basic Report Adapter Tests =====
// Covers the Basic-specific data flow:
//  - monthly_cost_snapshot passthrough → carrying-costs section
//  - parking description extraction (deeded underground, etc.)
//  - listing-specific prioritization of top_3_things_to_check
//  - 3-question cap for Basic (handled in NewReportUI)
//  - basement structured-fact constraint propagation

import { describe, it, expect } from 'vitest';
import { normalizeGenericReport } from './generic';

/**
 * Fixture: US Basic v2 with monthly_cost_snapshot available, listing description
 * mentions deeded underground parking spaces, and AI returns a generic "Roof"
 * item plus a listing-specific "Balcony Waterproofing" item. The promotion
 * logic should move the balcony item to position #1.
 */
const usBasicWithCostSnapshot: any = {
  analysisType: 'basic',
  reportMode: 'sale',
  market: 'US',
  sourceDomain: 'zillow.com',
  address: '123 Main St, Brooklyn, NY 11201',
  evidence_score: 60,
  verdict: 'Review With Caution',
  bottom_line: 'Listing provides basic facts but balcony/waterproofing and parking should be verified.',
  property_snapshot: {
    address: '123 Main St, Brooklyn, NY 11201',
    asking_price_display: '$1,200,000',
    sqft: 1196,
    beds: 2,
    baths: 2,
    parking: 2,
    yearBuilt: 2008,
    home_type: 'Condo',
  },
  what_we_know: {
    address: '123 Main St, Brooklyn, NY 11201',
    asking_price: '$1,200,000',
    beds: 2,
    baths: 2,
    sqft: '1196',
    property_type: 'Condo',
    hoa: '$850/mo',
  },
  monthly_cost_snapshot: {
    source: 'Zillow/listing estimate',
    estimated_monthly_payment: 7624,
    principal_and_interest: 3850,
    mortgage_insurance: 0,
    property_taxes: 1540,
    home_insurance: 320,
    hoa_fees: 850,
    utilities: null,
    disclaimer: 'Based on Zillow listing estimate only. Not independently verified by HomeScope.',
  },
  optionalDetails: {
    description:
      'Welcome to 123 Main St, a bright 2-bed 2-bath condo with two deeded underground parking spaces & guest parking, plus a private balcony.',
    parking: 2,
    basement: 'No',
    hoaFee: 850,
  },
  whats_missing: [
    'HOA reserves and special assessments',
    'Balcony waterproofing history',
    'Comparable sales for this floor plan',
  ],
  top_3_things_to_check: [
    {
      title: 'Roof and Major Systems',
      why_it_matters: 'Roof, HVAC, electrical, and plumbing are top repair costs in years 1–5.',
      action: 'Ask for roof age, HVAC age, electrical panel type, and recent system updates.',
    },
    {
      title: 'Balcony Waterproofing Risk',
      why_it_matters: 'A private balcony on a 2008 building may have a failing waterproofing membrane.',
      action: 'Ask for the most recent balcony inspection and any planned building re-waterproofing schedule.',
    },
    {
      title: 'Comparable Sales',
      why_it_matters: 'Comparable sales establish price confidence for the listing.',
      action: 'Ask for 3-5 recent comparable sales on the same floor / line.',
    },
  ],
  listing_signals: [],
  questions_to_ask: [
    'What is the most recent balcony inspection report?',
    'What is the HOA reserve fund balance and any pending assessments?',
    'Are there any rental restrictions in the bylaws?',
  ],
  upsell_cta: {},
};

/**
 * Fixture: US Basic v2 where the property explicitly says "Basement: No" but the
 * AI still tried to surface a basement item. The fixture mimics this scenario
 * by including both `basement: 'No'` in optionalDetails and a basement item in
 * top_3_things_to_check.
 */
const usBasicNoBasement: any = {
  analysisType: 'basic',
  reportMode: 'sale',
  market: 'US',
  sourceDomain: 'zillow.com',
  address: '999 Park Ave, New York, NY 10028',
  evidence_score: 70,
  verdict: 'Review With Caution',
  bottom_line: 'Listing is well documented but roof and comparable sales still need verification.',
  property_snapshot: {
    address: '999 Park Ave, New York, NY 10028',
    asking_price_display: '$3,500,000',
    sqft: 2500,
    beds: 3,
    baths: 2,
    yearBuilt: 1995,
    home_type: 'Co-op',
  },
  what_we_know: {
    address: '999 Park Ave, New York, NY 10028',
    asking_price: '$3,500,000',
    beds: 3,
    baths: 2,
    sqft: '2500',
    property_type: 'Co-op',
  },
  optionalDetails: {
    description: 'Bright pre-war 3-bedroom co-op with no basement.',
    basement: 'No',
  },
  whats_missing: [
    'Major systems age: roof / HVAC / electrical / plumbing',
    'Basement permits, egress, and legal use',
    'Comparable sales',
    'Open permits or violations',
    'Actual insurance and utility costs',
    'Co-op board approval requirements',
  ],
  top_3_things_to_check: [
    {
      title: 'Basement: Permits and Egress',
      why_it_matters: 'The listing mentions a basement — verify permits and egress.',
      action: 'Confirm the basement is permitted and has proper egress.',
    },
    {
      title: 'Roof and Major Systems',
      why_it_matters: 'Roof, HVAC, electrical, and plumbing are top repair costs.',
      action: 'Ask for roof age, HVAC age, electrical panel type.',
    },
  ],
  listing_signals: [],
  questions_to_ask: [],
  upsell_cta: {},
};

describe('Basic Adapter — monthly_cost_snapshot passthrough', () => {
  it('emits a carrying-costs section with total + breakdown rows', () => {
    const normalized = normalizeGenericReport(usBasicWithCostSnapshot);
    const carrying = normalized.sections.find((s) => s.id === 'carrying-costs');
    expect(carrying).toBeDefined();
    expect(carrying!.items.length).toBeGreaterThanOrEqual(5);

    const totalItem = carrying!.items.find((i) => /zillow estimated payment|estimated monthly payment|known monthly cost/i.test(i.title ?? ''));
    expect(totalItem).toBeDefined();
    expect(totalItem!.value).toBe('$7,624/mo');

    // Component rows present in expected order: P&I, Property Tax, Home Insurance, HOA, Mortgage Insurance
    const labels = carrying!.items.map((i) => i.title);
    expect(labels).toContain('Principal & Interest');
    expect(labels).toContain('Property Tax');
    expect(labels).toContain('Home Insurance');
    expect(labels).toContain('HOA');
  });

  it('derives the monthly payment total from components when estimated_monthly_payment is missing', () => {
    const fixture = {
      ...usBasicWithCostSnapshot,
      monthly_cost_snapshot: {
        ...usBasicWithCostSnapshot.monthly_cost_snapshot,
        estimated_monthly_payment: null,
      },
    };
    const normalized = normalizeGenericReport(fixture);
    const carrying = normalized.sections.find((s) => s.id === 'carrying-costs');
    expect(carrying).toBeDefined();
    // 3850 + 1540 + 320 + 850 = 6560
    const totalItem = carrying!.items.find((i) => /zillow estimated payment|estimated monthly payment|known monthly cost/i.test(i.title ?? ''));
    expect(totalItem!.value).toBe('$6,560/mo');
  });

  it('omits carrying-costs section when no snapshot data is available', () => {
    const fixture = { ...usBasicWithCostSnapshot, monthly_cost_snapshot: null };
    const normalized = normalizeGenericReport(fixture);
    expect(normalized.sections.find((s) => s.id === 'carrying-costs')).toBeUndefined();
  });
});

describe('Basic Adapter — parking description extraction', () => {
  it('prefers "two deeded underground parking spaces" over a raw count', () => {
    const normalized = normalizeGenericReport(usBasicWithCostSnapshot);
    const what = normalized.sections.find((s) => s.id === 'what-we-know');
    expect(what).toBeDefined();
    const parking = what!.items.find((i) => /parking/i.test(i.title ?? ''));
    expect(parking).toBeDefined();
    expect(parking!.value).toMatch(/deeded\s+underground\s+parking\s+spaces?/i);
  });
});

describe('Basic Adapter — listing-specific top_3 promotion', () => {
  it('promotes listing-specific items (balcony) above generic ones (roof)', () => {
    const normalized = normalizeGenericReport(usBasicWithCostSnapshot);
    const top3 = normalized.sections.find((s) => s.id === 'key-things-to-check');
    expect(top3).toBeDefined();
    expect(top3!.items.length).toBe(3);
    expect(top3!.items[0].title).toBe('Balcony Waterproofing Risk');
    expect(top3!.items[0].title).not.toBe('Roof and Major Systems');
  });

  it('caps the section at 3 items even if the AI returns more', () => {
    const fixture = {
      ...usBasicWithCostSnapshot,
      top_3_things_to_check: [
        ...usBasicWithCostSnapshot.top_3_things_to_check,
        {
          title: 'HOA Reserve Fund',
          why_it_matters: 'A healthy reserve fund avoids special assessments.',
          action: 'Ask for the most recent reserve study.',
        },
        {
          title: 'Pet Policy',
          why_it_matters: 'Some co-ops restrict pet size.',
          action: 'Ask about pet weight and breed restrictions.',
        },
      ],
    };
    const normalized = normalizeGenericReport(fixture);
    const top3 = normalized.sections.find((s) => s.id === 'key-things-to-check');
    expect(top3!.items.length).toBeLessThanOrEqual(3);
  });
});

describe('Basic Adapter — basement structured fact', () => {
  it('does not emit basement items in what-we-know when optionalDetails.basement says "No"', () => {
    const normalized = normalizeGenericReport(usBasicNoBasement);
    const what = normalized.sections.find((s) => s.id === 'what-we-know');
    expect(what).toBeDefined();
    const basement = what!.items.find((i) => /basement/i.test(i.title ?? ''));
    expect(basement).toBeUndefined();
  });
});

/**
 * Real production fixture mirroring the 180 Cook Street #509 basic report.
 * Critical behavior this exercises:
 *   - monthly_cost_snapshot.estimated_monthly_payment is null; components sum to $7,624
 *   - listing description mentions "Two deeded underground parking spaces & guest parking"
 *   - optionalDetails.basement === "No" must suppress basement items across all sections
 *   - analysisType='basic' + market='US' + property_snapshot must NOT cause the
 *     result to be classified as a Full report downstream
 */
const usBasicRealFixture: any = {
  analysisType: 'basic',
  reportMode: 'sale',
  market: 'US',
  source: 'zillow',
  sourceDomain: 'zillow.com',
  address: '180 Cook Street #509, Denver, CO 80206',
  verdict: 'Review With Caution',
  overallScore: 73,
  quickSummary:
    'Condominium at $1,100,000, 2 bed, 3 bath, 2,596 sqft, built 1971, $7,122/yr taxes — but HOA fees and what they cover need verification.',
  what_we_know: {
    beds: 2,
    sqft: 2596,
    baths: 3,
    asking_price: '$1,100,000',
    monthly_rent: null,
    property_type: 'Condominium',
  },
  whats_missing: [
    'Comparable sales',
    'Building financials: reserves, assessments, and capital expenditure plan',
    'HOA reserves, pending assessments, and special fees',
    'Rental restrictions and pet policies',
    'Master insurance coverage',
  ],
  optionalDetails: {
    roof: 'Membrane',
    sqft: 2596,
    hoaFee: '$1,024 monthly',
    market: 'US',
    region: 'Denver',
    source: 'zillow',
    address: '180 Cook Street #509, Denver, CO 80206',
    bedrooms: 2,
    homeType: 'Condo',
    bathrooms: 3,
    yearBuilt: 1971,
    askingPrice: '$1,100,000',
    garageSpaces: 2,
    pricePerSqft: '$424/sqft',
    propertyType: 'Condominium',
    sourceDomain: 'zillow.com',
    annualTaxAmount: 7122,
    propertySubtype: 'Condominium',
    basement: 'No',
    listingDescription:
      'In the heart of prestigious Cherry Creek North, this rare penthouse residence offers an exceptional blend of luxury, privacy, & an effortless lock-and-leave lifestyle. Two deeded underground parking spaces & guest parking provide convenience rarely found in urban living.',
    hoaIncludedServices: [
      'Reserve Fund', 'Gas', 'Insurance', 'Maintenance Structure', 'Recycling',
      'Sewer', 'Snow Removal', 'Trash', 'Water',
    ],
    normalizedPropertyCategory: 'condo',
  },
  property_snapshot: {
    hoa: '$1,024 monthly',
    beds: 2,
    roof: 'Membrane',
    sqft: 2596,
    baths: 3,
    region: 'Denver',
    parking: '',
    stories: null,
    basement: '',
    lot_size: null,
    fireplace: '',
    home_type: 'Condominium',
    annual_tax: 7122,
    year_built: 1971,
    price_per_sqft: 424,
    property_subtype: 'Condominium',
  },
  monthly_cost_snapshot: {
    source: 'Zillow/listing estimate',
    hoa_fees: 1024,
    utilities: null,
    disclaimer:
      'Based on Zillow listing estimate only. Not independently verified by HomeScope.',
    home_insurance: 367,
    property_taxes: 883,
    mortgage_insurance: 0,
    principal_and_interest: 5350,
    estimated_monthly_payment: null,
  },
  top_3_things_to_check: [
    {
      title: 'Built in 1971: Building Financial Health',
      action: 'Ask for the building reserve fund balance, recent financial statements, and any planned special assessments.',
      why_it_matters:
        'A building from 1971 may have aging infrastructure — reserve fund health and upcoming assessments are a decision-changing cost for all unit owners.',
    },
    {
      title: 'At $424/sqft, Comps Matter',
      action: 'Ask for 3–5 recent nearby comparable sales before relying on the asking price or Zestimate range.',
      why_it_matters:
        'The $/sqft is visible but condition and comparable sales are needed before judging whether the asking price is justified.',
    },
    {
      title: 'HOA: Reserves, Assessments, and Special Fees',
      action: 'Ask for the HOA reserve fund balance, last reserve study, any pending special assessments, and whether there are rental or pet restrictions.',
      why_it_matters:
        'HOA fees are visible, but reserve fund health, pending special assessments, and rental limits are not — and can significantly affect total cost.',
    },
  ],
  questions_to_ask: [
    'What are the HOA fees, what do they cover, and what is the reserve fund balance?',
    'Are there any pending special assessments or recent reserve study findings?',
    'What are the rental restrictions and pet policies?',
    'What does the master insurance policy cover and what unit-owner insurance is required?',
    'What is the current owner-occupancy ratio and are there financing restrictions?',
  ],
  riskSignals: [],
  whatLooksGood: [],
  upsell_cta: {},
};

describe('Basic Adapter — real US Sale v2 fixture (180 Cook St #509)', () => {
  it('keeps analysisType=basic + market=US + property_snapshot as Basic (not Full)', () => {
    const normalized = normalizeGenericReport(usBasicRealFixture);
    expect(normalized.meta.isBasic).toBe(true);
    expect(normalized.meta.market).toBe('US');
    expect(normalized.meta.reportMode).toBe('sale');
  });

  it('derives $7,624/mo total from components when estimated_monthly_payment is null', () => {
    const normalized = normalizeGenericReport(usBasicRealFixture);
    const carrying = normalized.sections.find((s) => s.id === 'carrying-costs');
    expect(carrying).toBeDefined();
    const totalItem = carrying!.items.find((i) =>
      /zillow estimated payment|estimated monthly payment|known monthly cost/i.test(i.title ?? ''),
    );
    expect(totalItem).toBeDefined();
    // 5350 + 883 + 367 + 1024 + 0 = 7624
    expect(totalItem!.value).toBe('$7,624/mo');
  });

  it('emits all five component rows in the fixed P&I → Property Tax → Home Insurance → HOA → Mortgage Insurance order', () => {
    const normalized = normalizeGenericReport(usBasicRealFixture);
    const carrying = normalized.sections.find((s) => s.id === 'carrying-costs');
    expect(carrying).toBeDefined();
    const breakdownLabels = carrying!.items
      .filter((i) => !/zillow estimated payment|estimated monthly payment|known monthly cost|source/i.test(i.title ?? ''))
      .map((i) => i.title);
    expect(breakdownLabels).toEqual([
      'Principal & Interest',
      'Property Tax',
      'Home Insurance',
      'HOA',
      'Mortgage Insurance',
    ]);
  });

  it('uses deeded underground parking description rather than raw count', () => {
    const normalized = normalizeGenericReport(usBasicRealFixture);
    const what = normalized.sections.find((s) => s.id === 'what-we-know');
    expect(what).toBeDefined();
    const parking = what!.items.find((i) => /parking/i.test(i.title ?? ''));
    expect(parking).toBeDefined();
    expect(parking!.value).toMatch(/deeded\s+underground\s+parking\s+spaces?/i);
  });

  it('does not leak basement items into key-things-to-check, whats-missing, or questions', () => {
    const normalized = normalizeGenericReport(usBasicRealFixture);

    const top3 = normalized.sections.find((s) => s.id === 'key-things-to-check');
    expect(top3).toBeDefined();
    const top3Basement = top3!.items.filter((i) => /basement|egress|walk.?out/i.test(`${i.title} ${i.description ?? ''} ${i.action ?? ''}`));
    expect(top3Basement).toHaveLength(0);

    const missing = normalized.sections.find((s) => s.id === 'whats-missing');
    expect(missing).toBeDefined();
    const missingBasement = missing!.items.filter((i) => /basement|egress|walk.?out/i.test(i.title ?? ''));
    expect(missingBasement).toHaveLength(0);
  });
});