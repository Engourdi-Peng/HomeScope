// ===== NewReportUI layout resolver tests =====
//
// Lock the Basic vs Full routing contract so that:
//   - A US Basic Sale v2 result (analysisType='basic', market='US',
//     property_snapshot, monthly_cost_snapshot) stays in the Basic layout.
//   - A Full result (analysisType='full' OR Full-only fields like
//     risk_categories / maintenance_risk / carrying_costs) stays in Full.
//   - The historical regression where property_snapshot and market='US'
//     alone could downgrade a Basic report into the Full layout does not
//     recur.

import { describe, it, expect } from 'vitest';
import { resolveIsBasicLayout } from '../../components/report/NewReportUI';

const basicUsFixture: Record<string, unknown> = {
  analysisType: 'basic',
  reportMode: 'sale',
  market: 'US',
  sourceDomain: 'zillow.com',
  property_snapshot: {
    beds: 2,
    baths: 3,
    sqft: 2596,
    year_built: 1971,
    home_type: 'Condominium',
  },
  monthly_cost_snapshot: {
    hoa_fees: 1024,
    property_taxes: 883,
    home_insurance: 367,
    principal_and_interest: 5350,
    mortgage_insurance: 0,
    estimated_monthly_payment: null,
  },
  top_3_things_to_check: [
    { title: 'Built in 1971: Building Financial Health' },
  ],
};

const fullUsFixture: Record<string, unknown> = {
  analysisType: 'full',
  reportMode: 'sale',
  market: 'US',
  sourceDomain: 'zillow.com',
  property_snapshot: { beds: 3 },
  risk_categories: { foundation_basement: 'Low' },
  maintenance_risk: 'Low',
  carrying_costs: { monthly_breakdown: [] },
};

describe('resolveIsBasicLayout — Basic US Sale v2 result', () => {
  it('stays in Basic when raw.analysisType="basic" even with property_snapshot and market="US"', () => {
    expect(resolveIsBasicLayout(basicUsFixture, false, false)).toBe(true);
  });

  it('stays in Basic when propIsBasic is also true', () => {
    expect(resolveIsBasicLayout(basicUsFixture, true, true)).toBe(true);
  });

  it('stays in Basic when viewModel says isBasic=true (default resolution path)', () => {
    expect(resolveIsBasicLayout(basicUsFixture, false, true)).toBe(true);
  });

  it('does NOT downgrade to Full when monthly_cost_snapshot is present', () => {
    expect(resolveIsBasicLayout(basicUsFixture, false, false)).toBe(true);
  });
});

describe('resolveIsBasicLayout — Full US Sale result', () => {
  it('returns false when raw.analysisType="full"', () => {
    expect(resolveIsBasicLayout(fullUsFixture, true, true)).toBe(false);
  });

  it('returns false when risk_categories is present', () => {
    const r = { ...fullUsFixture, analysisType: undefined as unknown };
    expect(resolveIsBasicLayout(r, true, true)).toBe(false);
  });

  it('returns false when carrying_costs is present (even if analysisType missing)', () => {
    const r: Record<string, unknown> = { carrying_costs: { monthly_breakdown: [] } };
    expect(resolveIsBasicLayout(r, true, true)).toBe(false);
  });

  it('returns false when maintenance_risk is present (even if analysisType missing)', () => {
    const r: Record<string, unknown> = { maintenance_risk: 'Low' };
    expect(resolveIsBasicLayout(r, true, true)).toBe(false);
  });
});

describe('resolveIsBasicLayout — legacy Full signal still works', () => {
  it('treats listing_does_not_prove as Full', () => {
    const r: Record<string, unknown> = { listing_does_not_prove: ['foo'] };
    expect(resolveIsBasicLayout(r, true, true)).toBe(false);
  });

  it('treats before_you_book_showing as Full', () => {
    const r: Record<string, unknown> = { before_you_book_showing: ['foo'] };
    expect(resolveIsBasicLayout(r, true, true)).toBe(false);
  });
});

describe('resolveIsBasicLayout — null / undefined raw is safe', () => {
  it('falls back to propIsBasic when raw is null', () => {
    expect(resolveIsBasicLayout(null, true, false)).toBe(true);
    expect(resolveIsBasicLayout(null, false, false)).toBe(false);
  });

  it('falls back to propIsBasic when raw is undefined', () => {
    expect(resolveIsBasicLayout(undefined, true, false)).toBe(true);
    expect(resolveIsBasicLayout(undefined, false, false)).toBe(false);
  });
});