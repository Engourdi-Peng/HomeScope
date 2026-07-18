/**
 * flow-verify.ts — 验证 rent 路径不混入 Sale adapter/UI
 */
import { normalizeReportResult } from '../src/lib/reportAdapters/normalizeReport';
import type { AnyResult } from '../src/lib/reportAdapters/types';

const usRentResult: AnyResult = {
  market: 'US',
  reportMode: 'rent',
  sourceDomain: 'zillow.com',
  propertyType: 'Apartment',
  address: '123 Main St, Queens, NY 11361',
  title: '123 Main St',
  rental_listing_score: 78,
  rental_snapshot: {
    address: '123 Main St',
    monthly_rent: 2300,
    available_date: '2026-08-01',
    lease_term: '12 months',
  },
  rental_listing_trust: { confirmed_facts: [], unverified_claims: [] },
  rent_fairness: { market_average: 2350, verdict: 'fair' },
  rent_zestimate: 2300,
  rental_risk_categories: [{ key: 'lease_terms', level: 'low', rationale: 'Standard' }],
};

const usSaleResult: AnyResult = {
  market: 'US',
  reportMode: 'sale',
  sourceDomain: 'zillow.com',
  propertyType: 'Single Family',
  address: '456 Oak Ave',
  property_snapshot: { address: '456 Oak Ave', bedrooms: 3, bathrooms: 2 },
  carrying_costs: { monthly_total: 4200, breakdown: [] },
  price_assessment: { asking_price: 850000, market_average: 870000, verdict: 'fair' },
  risk_categories: [{ key: 'roof_exterior', level: 'medium' }],
  listing_does_not_prove: [],
  before_you_book_showing: [],
};

const unknownResult: AnyResult = {
  market: 'US',
  sourceDomain: 'example.com',
  propertyType: 'House',
  address: '789 Pine Rd',
  some_field: 'x',
  overall_score: 70,
  verdict: 'fair',
  decision: 'looks ok',
  analysisType: 'basic',
  what_we_know: ['Has 3 bedrooms', 'Built in 1990'],
  risk_categories: [
    { key: 'flood', level: 'low', rationale: 'No flood history reported' },
  ],
  listing_does_not_prove: ['Recent roof replacement'],
  before_you_book_showing: ['Confirm listing details'],
};

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(msg);
  }
}

const rentNorm = normalizeReportResult(usRentResult);
check(rentNorm.meta.market === 'US', 'Rent path → meta.market=US');
check(rentNorm.meta.reportMode === 'rent', 'Rent path → meta.reportMode=rent');
check(
  rentNorm.hero.title === '123 Main St' || (rentNorm.hero.address ?? '').includes('123 Main St'),
  'Rent path → hero has rent address',
);
check(
  !rentNorm.sections.some(s => s.id === 'carrying-costs' || s.id === 'price-assessment'),
  'Rent path → no sale sections',
);
check(
  rentNorm.sections.some(s => s.id === 'rent-fairness' || s.id === 'rental-snapshot'),
  'Rent path → has rent-fairness or rental-snapshot',
);
check(
  (rentNorm.meta.usedSectionIds ?? []).some(id => /rent/i.test(id)) ||
    rentNorm.sections.some(s => /rent|rental/i.test(s.id)),
  'Rent path → sections include rent/rental IDs',
);

const saleNorm = normalizeReportResult(usSaleResult);
check(saleNorm.meta.market === 'US', 'Sale path → meta.market=US');
check(saleNorm.meta.reportMode === 'sale', 'Sale path → meta.reportMode=sale');
check(
  saleNorm.sections.some(s => s.id === 'carrying-costs' || s.id === 'price-assessment'),
  'Sale path → has carrying-costs or price-assessment',
);
check(
  !saleNorm.sections.some(s => s.id === 'rent-fairness' || s.id === 'rental-snapshot'),
  'Sale path → no rent sections',
);
check(
  saleNorm.sections.some(s => /carrying|price|property_snapshot|risk/i.test(s.id)),
  'Sale path → sections include sale-shape IDs',
);

const unknownNorm = normalizeReportResult(unknownResult);
check(
  unknownNorm.meta.market === 'US',
  'Unknown → meta.market=US (inferred from sourceDomain)',
);
check(
  Array.isArray(unknownNorm.sections),
  'Unknown → generic adapter returns sections array (no crash)',
);
check(
  unknownNorm.meta.isBasic === true,
  'Unknown → isBasic=true (basic-shape recognized)',
);

const summary = `\nflow-verify: ${pass} passed, ${fail} failed\n`;
if (fail > 0) {
  console.error(summary + 'Failures:\n' + failures.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(summary);