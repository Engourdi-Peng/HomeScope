import { describe, expect, it, vi } from 'vitest';
import { buildRiskTriggers, classifyBuyerReportMode, buildPropertyIntelligenceProfile } from './reportRules';
import type { BuyerReportMode } from './types';

describe('reportRules', () => {
  it('classifies buyer report mode for condo, multifamily, land, and new construction', () => {
    expect(classifyBuyerReportMode({ normalizedPropertyCategory: 'condo', propertyType: 'Condominium' })).toBe('condo_hoa');
    expect(classifyBuyerReportMode({ normalizedPropertyCategory: 'multi_family', propertyType: 'Multi Family', listingText: 'legal 2 family with income unit' })).toBe('multi_family_income');
    expect(classifyBuyerReportMode({ normalizedPropertyCategory: 'land', propertyType: 'Vacant Lot' })).toBe('land_or_development');
    expect(classifyBuyerReportMode({ propertyType: 'Single Family', yearBuilt: new Date().getFullYear(), listingText: 'new construction with builder warranty' })).toBe('new_construction');
  });

  it('triggers oil heating, basement, flood, older home rules from verified facts', () => {
    const triggers = buildRiskTriggers({
      buyerReportMode: 'single_family_owner_occupier',
      verifiedFacts: {
        heating: 'Oil',
        basement: 'Finished basement',
        yearBuilt: 1950,
        pricePerSqft: 825,
        pricePerSqft_display: '$825/sqft',
        floodZone: 'FEMA Zone X',
        region: 'Long Island waterfront',
        propertyType: 'Single Family',
      },
      listingText: 'Expansion potential with ADU possibility and needs updating.',
      topConcerns: ['dated bathroom', 'older fixtures'],
      detectedAreas: ['basement', 'kitchen'],
    });

    const activeKeys = triggers.filter((item) => item.triggered).map((item) => item.key);
    expect(activeKeys).toEqual(expect.arrayContaining([
      'oilHeating', 'basementPresent', 'buildOutMarketing',
      'highPricePerSqftWithDatedCondition', 'floodZoneKnown', 'olderHome',
    ]));

    const oil = triggers.find((item) => item.key === 'oilHeating');
    expect(oil?.forbiddenClaims).toContain('contamination');
    const basement = triggers.find((item) => item.key === 'basementPresent');
    expect(basement?.requiredQuestions.join(' ')).toMatch(/moisture|egress|square footage/i);
  });

  it('does NOT trigger flood rule when floodZone is absent and region is not flood-sensitive', () => {
    const triggers = buildRiskTriggers({
      buyerReportMode: 'single_family_owner_occupier',
      verifiedFacts: {
        heating: 'Gas forced air',
        yearBuilt: 1980,
        pricePerSqft: 400,
        propertyType: 'Single Family',
      },
      listingText: 'Updated kitchen and bath.',
      topConcerns: [],
      detectedAreas: ['kitchen', 'bathroom'],
    });
    const activeKeys = triggers.filter((item) => item.triggered).map((item) => item.key);
    expect(activeKeys).not.toContain('floodZoneKnown');
    expect(activeKeys).not.toContain('floodZoneMissingButRegionSensitive');
  });

  it('triggers floodZoneMissingButRegionSensitive in coastal region without floodZone', () => {
    const triggers = buildRiskTriggers({
      buyerReportMode: 'single_family_owner_occupier',
      verifiedFacts: {
        yearBuilt: 1970,
        propertyType: 'Single Family',
        region: 'Miami coastal area',
        floodZone: null,
      },
      listingText: 'Ocean views.',
      topConcerns: [],
      detectedAreas: [],
    });
    const activeKeys = triggers.filter((item) => item.triggered).map((item) => item.key);
    expect(activeKeys).toContain('floodZoneMissingButRegionSensitive');
  });

  it('suppresses forbidden claims for oil heating — no contamination or underground tank', () => {
    const triggers = buildRiskTriggers({
      buyerReportMode: 'single_family_owner_occupier',
      verifiedFacts: { heating: 'Oil', yearBuilt: 1960, propertyType: 'Single Family' },
      listingText: '',
      topConcerns: [],
      detectedAreas: [],
    });
    const oil = triggers.find((item) => item.key === 'oilHeating');
    expect(oil?.triggered).toBe(true);
    expect(oil?.allowedClaims).toContain('verify oil tank location');
    // contamination is forbidden — it must not appear in allowed claims
    expect(oil?.forbiddenClaims).toContain('contamination');
    expect(oil?.forbiddenClaims).toContain('removal cost');
    expect(oil?.forbiddenClaims).toContain('underground tank');
    expect(oil?.allowedClaims).not.toContain('contamination');
    expect(oil?.allowedClaims).not.toContain('removal cost');
  });

  // ── buildPropertyIntelligenceProfile ─────────────────────────────────────────

  it('classifies co_op listing with subletting prohibited', () => {
    const p = buildPropertyIntelligenceProfile({
      propertyType: 'Co-op',
      listingText: 'Subletting prohibited. Board approval required. Monthly maintenance $1,200 includes utilities. Flip tax applies on resale.',
      zestimateAvailable: true,
    });
    expect(p.propertyCategory).toBe('co_op');
    expect(p.ownershipModel).toBe('cooperative');
    expect(p.primaryDecisionAxis.some(ax => ax.includes('Board approval'))).toBe(true);
    expect(p.irrelevantGenericRisksToAvoid).toContain('roof age');
    expect(p.irrelevantGenericRisksToAvoid).toContain('hvac age');
    expect(p.decisiveListingSignals).toContain('subletting prohibited');
    expect(p.confidence).toBe('high');
  });

  it('classifies condo listing with HOA', () => {
    const p = buildPropertyIntelligenceProfile({
      propertyType: 'Condo',
      listingText: 'Monthly HOA $650. No rental restrictions. Pet friendly building. Flip tax applies on resale.',
    });
    expect(p.propertyCategory).toBe('condo');
    expect(p.ownershipModel).toBe('condominium');
    expect(p.irrelevantGenericRisksToAvoid).toContain('roof age');
    expect(p.decisiveListingSignals).toContain('hoa fee');
    expect(p.decisiveListingSignals).toContain('flip tax');
  });

  it('classifies multi_family listing', () => {
    const p = buildPropertyIntelligenceProfile({
      propertyType: 'Multi Family',
      listingText: 'Legal 2 family with walk in apartment. Separate entrance. Near transit. Mother daughter setup. Income unit. Rent stabilized.',
    });
    expect(p.propertyCategory).toBe('multi_family');
    expect(p.likelyBuyerUseCase).toBe('investment');
    expect(p.primaryDecisionAxis.some(ax => ax.includes('Certificate of Occupancy'))).toBe(true);
    expect(p.decisiveListingSignals).toContain('legal 2 family');
    expect(p.decisiveListingSignals).toContain('walk in apartment');
    expect(p.decisiveListingSignals).toContain('mother daughter');
    expect(p.decisiveListingSignals).toContain('income unit');
    expect(p.irrelevantGenericRisksToAvoid).toContain('roof age');
  });

  it('single_family has no irrelevant risks to avoid', () => {
    const p = buildPropertyIntelligenceProfile({ propertyType: 'Single Family' });
    expect(p.propertyCategory).toBe('single_family');
    expect(p.ownershipModel).toBe('fee_simple');
    expect(p.irrelevantGenericRisksToAvoid).toEqual([]);
  });

  it('townhouse suppresses roof age', () => {
    const p = buildPropertyIntelligenceProfile({ propertyType: 'Townhouse' });
    expect(p.propertyCategory).toBe('townhouse');
    expect(p.irrelevantGenericRisksToAvoid).toContain('roof age');
    expect(p.irrelevantGenericRisksToAvoid).not.toContain('hvac age');
  });

  it('land suppresses all residential systems', () => {
    const p = buildPropertyIntelligenceProfile({ propertyType: 'Vacant Lot' });
    expect(p.propertyCategory).toBe('land');
    expect(p.irrelevantGenericRisksToAvoid).toContain('roof');
    expect(p.irrelevantGenericRisksToAvoid).toContain('hvac');
    expect(p.irrelevantGenericRisksToAvoid).toContain('basement');
  });

  it('extracts decisive signals for condo from listing text', () => {
    const p = buildPropertyIntelligenceProfile({
      propertyType: 'Condo',
      listingText: 'flip tax of 2% applies. Rental restrictions in place. Monthly HOA $500.',
    });
    expect(p.decisiveListingSignals).toContain('flip tax');
    expect(p.decisiveListingSignals).toContain('rental restriction');
    expect(p.decisiveListingSignals).toContain('hoa fee');
  });

  it('extracts decisive signals for multi_family from listing text', () => {
    const p = buildPropertyIntelligenceProfile({
      propertyType: 'Multi Family',
      listingText: 'mother daughter setup. Separate street entrance. Rent stabilized unit downstairs. Legal 2 family. Walk in apartment available.',
    });
    expect(p.decisiveListingSignals).toContain('mother daughter');
    expect(p.decisiveListingSignals).toContain('separate entrance');
    expect(p.decisiveListingSignals).toContain('rent stabilized');
    expect(p.decisiveListingSignals).toContain('legal 2 family');
    expect(p.decisiveListingSignals).toContain('walk in apartment');
  });

  it('confidence is high when zestimate and taxHistory are available', () => {
    const p = buildPropertyIntelligenceProfile({
      propertyType: 'Co-op',
      listingText: 'Board approval required. Monthly maintenance includes utilities. Subletting prohibited. Flip tax applies.',
      zestimateAvailable: true,
      taxHistory: 'taxes $8,000/yr',
    });
    expect(p.confidence).toBe('high');
  });

  it('confidence is low when only normalizedPropertyCategory is set and no other evidence', () => {
    // Only category (no propertyType, no listing text, no signals)
    const p = buildPropertyIntelligenceProfile({ normalizedPropertyCategory: 'condo' });
    expect(p.confidence).toBe('low');
  });

  it('confidence is medium when propertyType is available but no other signals', () => {
    // propertyType provides a base confidence
    const p = buildPropertyIntelligenceProfile({ propertyType: 'Condo' });
    expect(p.confidence).toBe('medium');
  });

  it('uses normalizedPropertyCategory as authoritative source', () => {
    const p = buildPropertyIntelligenceProfile({
      normalizedPropertyCategory: 'co_op',
      propertyType: 'Condo', // should be overridden
    });
    expect(p.propertyCategory).toBe('co_op');
  });
});
