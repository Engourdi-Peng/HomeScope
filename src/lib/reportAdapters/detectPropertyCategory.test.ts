/**
 * Tests for detectPropertyCategory — structured field priority enforcement.
 * These tests verify that Zillow structured fields (homeType, propertySubtype,
 * propertyType) take priority over listing text keywords, preventing agent
 * wording like "duplex home" from overriding a Single Family classification.
 */

import { describe, it, expect } from 'vitest';

// Inline copies of the pure helper functions from analyze/index.ts
// (Test must be self-contained and not import Supabase Edge Function code)

type PropertyIntelligenceCategory =
  | 'co_op' | 'condo' | 'multi_family' | 'single_family'
  | 'townhouse' | 'land' | 'manufactured' | 'unknown';

interface BuildProfileInput {
  normalizedPropertyCategory?: string | null;
  propertyType?: string | null;
  propertySubtype?: string | null;
  homeType?: string | null;
  listingText?: string | null;
}

const PROPERTY_CATEGORY_PATTERNS: Array<[PropertyIntelligenceCategory, string[]]> = [
  ['co_op',        ['co_op', 'coop', 'co op', 'stock cooperative', 'cooperative']],
  ['condo',        ['condo', 'condominium', 'condop']],
  ['multi_family', ['multi_family', 'multi family', 'duplex', 'triplex', '2 family', '2-family', 'legal 2 family', 'income unit', 'two family', 'two-family', 'three family', 'three-family', 'four family', 'four-family']],
  ['townhouse',    ['townhouse', 'townhome', 'rowhouse', 'row house']],
  ['land',         ['land', 'lot', 'vacant', 'development site', 'acreage']],
  ['manufactured', ['manufactured', 'mobile home', 'double wide', 'double-wide', 'trailer']],
  ['single_family', ['single family', 'single-family', 'single family residence', 'single-family residence', 'singlefamily', 'single_family', 'detached house', 'detached', 'house']],
];

function normalizeCategoryToken(raw: string): string {
  return raw.toLowerCase().replace(/[_-]/g, ' ').trim();
}

function detectPropertyCategory(input: BuildProfileInput): { category: PropertyIntelligenceCategory; source: string } {
  // Priority 1: normalizedPropertyCategory
  if (input.normalizedPropertyCategory) {
    const nc = normalizeCategoryToken(input.normalizedPropertyCategory);
    for (const [cat, patterns] of PROPERTY_CATEGORY_PATTERNS) {
      if (patterns.some(p => p === nc)) return { category: cat, source: 'normalizedPropertyCategory' };
    }
    return { category: 'unknown', source: 'normalizedPropertyCategory' };
  }

  // Priority 2: structured fields
  const structuredFields: Array<{ value: string | null | undefined; name: string }> = [
    { value: input.homeType,        name: 'homeType' },
    { value: input.propertySubtype, name: 'propertySubtype' },
    { value: input.propertyType,    name: 'propertyType' },
  ];

  for (const { value, name } of structuredFields) {
    if (!value) continue;
    const token = normalizeCategoryToken(value);
    for (const [cat, patterns] of PROPERTY_CATEGORY_PATTERNS) {
      if (patterns.some(p => p === token || token.includes(p) || p.includes(token))) {
        return { category: cat, source: name };
      }
    }
  }

  // Priority 3: listingText
  const text = (input.listingText ?? '').toLowerCase();
  for (const [cat, patterns] of PROPERTY_CATEGORY_PATTERNS) {
    if (patterns.some(p => text.includes(p))) {
      return { category: cat, source: 'listingText' };
    }
  }

  return { category: 'unknown', source: 'none' };
}

// ── Test Cases ────────────────────────────────────────────────────────────────

describe('detectPropertyCategory — structured field priority', () => {

  it('CASE 1: homeType=SingleFamily, listingText includes "duplex home" → single_family from homeType', () => {
    // This is the exact failing scenario from the bug report:
    // "custom-made duplex home" in description must NOT override SingleFamily classification.
    const result = detectPropertyCategory({
      homeType: 'SingleFamily',
      propertyType: 'Single Family Residence',
      propertySubtype: 'Single Family Residence',
      listingText: 'This is a custom-made duplex home in Bayside NY with great potential. Delivered vacant.',
    });
    expect(result.category).toBe('single_family');
    expect(result.source).toBe('homeType');
  });

  it('CASE 2: propertyType=Single Family Residence (no structured field match on SingleFamily) → single_family from propertyType', () => {
    const result = detectPropertyCategory({
      propertyType: 'Single Family Residence',
      listingText: 'duplex style home investment opportunity rental income',
    });
    expect(result.category).toBe('single_family');
    expect(result.source).toBe('propertyType');
  });

  it('CASE 3: propertySubtype=Single Family Residence → single_family from propertySubtype', () => {
    const result = detectPropertyCategory({
      propertySubtype: 'Single Family Residence',
      listingText: 'legal 2 family multi-family duplex income unit',
    });
    expect(result.category).toBe('single_family');
    expect(result.source).toBe('propertySubtype');
  });

  it('CASE 4: normalizedPropertyCategory=single_family → normalizedPropertyCategory (even if text says duplex)', () => {
    const result = detectPropertyCategory({
      normalizedPropertyCategory: 'single_family',
      propertyType: 'Single Family Residence',
      homeType: 'SingleFamily',
      listingText: 'duplex investor opportunity two-family income property delivered vacant',
    });
    expect(result.category).toBe('single_family');
    expect(result.source).toBe('normalizedPropertyCategory');
  });

  it('CASE 5: no structured fields → listingText fallback to multi_family when text contains "duplex"', () => {
    const result = detectPropertyCategory({
      listingText: 'Legal 2 family duplex in Queens with separate entrances and rental income potential.',
    });
    expect(result.category).toBe('multi_family');
    expect(result.source).toBe('listingText');
  });

  it('CASE 6: propertyType=Condominium, text says "duplex" → condo from propertyType', () => {
    const result = detectPropertyCategory({
      propertyType: 'Condominium',
      listingText: 'duplex condo with separate floors and income potential',
    });
    expect(result.category).toBe('condo');
    expect(result.source).toBe('propertyType');
  });

  it('CASE 7: propertyType=Condo → condo', () => {
    const result = detectPropertyCategory({
      propertyType: 'Condo',
      listingText: 'income unit investment rental duplex',
    });
    expect(result.category).toBe('condo');
    expect(result.source).toBe('propertyType');
  });

  it('CASE 8: homeType=Townhouse → townhouse even if text has house keyword', () => {
    const result = detectPropertyCategory({
      homeType: 'Townhouse',
      listingText: 'detached house single family residence',
    });
    expect(result.category).toBe('townhouse');
    expect(result.source).toBe('homeType');
  });

  it('CASE 9: all structured fields empty → listingText "land lot" → land', () => {
    const result = detectPropertyCategory({
      listingText: 'Vacant lot in the hills. Land development site.',
    });
    expect(result.category).toBe('land');
    expect(result.source).toBe('listingText');
  });

  it('CASE 10: normalizedPropertyCategory=unknown (explicit) → unknown even if text says duplex', () => {
    const result = detectPropertyCategory({
      normalizedPropertyCategory: 'unknown',
      listingText: 'duplex income unit legal 2 family',
    });
    expect(result.category).toBe('unknown');
    expect(result.source).toBe('normalizedPropertyCategory');
  });

  it('CASE 11: SingleFamily as propertyType (no space) → single_family', () => {
    const result = detectPropertyCategory({
      propertyType: 'SingleFamily',
      listingText: 'income unit investment duplex',
    });
    expect(result.category).toBe('single_family');
    expect(result.source).toBe('propertyType');
  });

  it('CASE 12: SINGLE_FAMILY uppercase → single_family', () => {
    const result = detectPropertyCategory({
      propertyType: 'SINGLE_FAMILY',
      listingText: 'duplex home investor',
    });
    expect(result.category).toBe('single_family');
    expect(result.source).toBe('propertyType');
  });

  it('CASE 13: Detached as homeType → single_family', () => {
    const result = detectPropertyCategory({
      homeType: 'Detached',
      listingText: 'multi-family duplex income unit',
    });
    expect(result.category).toBe('single_family');
    expect(result.source).toBe('homeType');
  });

  it('CASE 14: no structured fields, no text match → unknown', () => {
    const result = detectPropertyCategory({
      listingText: 'Property with great potential and amazing views.',
    });
    expect(result.category).toBe('unknown');
    expect(result.source).toBe('none');
  });

  it('CASE 15: Co-op pattern variants → co_op', () => {
    expect(detectPropertyCategory({ propertyType: 'Co-op' })).toEqual({ category: 'co_op', source: 'propertyType' });
    expect(detectPropertyCategory({ propertyType: 'Cooperative' })).toEqual({ category: 'co_op', source: 'propertyType' });
    expect(detectPropertyCategory({ propertyType: 'CO-OP' })).toEqual({ category: 'co_op', source: 'propertyType' });
  });

  it('CASE 16: Duplex only in listingText (no structured field) → multi_family', () => {
    const result = detectPropertyCategory({
      listingText: 'This home features a duplex layout. Great for investors.',
    });
    expect(result.category).toBe('multi_family');
    expect(result.source).toBe('listingText');
  });

  it('CASE 17: Duplex in structured field → multi_family takes priority', () => {
    const result = detectPropertyCategory({
      propertyType: 'Duplex',
      listingText: 'single family home with one unit',
    });
    expect(result.category).toBe('multi_family');
    expect(result.source).toBe('propertyType');
  });
});
