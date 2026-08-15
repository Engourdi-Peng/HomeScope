/**
 * Cross-listing regression matrix for generic multi-unit rental extraction.
 *
 * These tests do NOT depend on any specific listing, address, unit, or photo
 * count. They assert the resolver's generic contract on a wide range of
 * synthetic payloads that mirror the field shapes documented in
 * `docs/zillow-golden-cases/`. The same contract applies to:
 *
 *  - Winbro (#1) and any other Zillow multi-unit building rent page (#6)
 *  - Building-with-selected-unit (#2)
 *  - Selected-unit URLs (#7 private-room nearby)
 *  - Single-family rent and sale pages (#3, #5)
 *  - Condo/townhouse sale pages (#4)
 *  - Multifamily sale pages (#8)
 *
 * The test cases use representative shapes; new golden cases just plug
 * different numbers in.
 */
import { describe, expect, it } from 'vitest';
import { resolveBuildingDetails } from './buildingDetails';

describe('resolveBuildingDetails — cross-listing generic contract', () => {
  it('preserves floor plan roll-up fees ($775–$895 advertised, $765–$885 base)', () => {
    const result = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      market: 'US',
      buildingDetails: {
        availableUnitCount: 3,
        identifiedUnitCount: 3,
        availableUnits: [
          { unitNumber: '103', bedrooms: 1, bathrooms: 1, sqft: 320, monthlyRent: 775, availableFrom: 'Aug 14' },
          { unitNumber: '210', bedrooms: 1, bathrooms: 1, sqft: 320, monthlyRent: 895, availableFrom: 'Aug 24' },
        ],
        floorPlanSummaries: [
          {
            planName: 'Studio',
            bedrooms: 0,
            bathrooms: 1,
            sqft: 320,
            unitCount: 3,
            minPrice: 775,
            maxPrice: 895,
            minBaseRent: 765,
            maxBaseRent: 885,
          },
        ],
        rentalCostCalculator: {
          estimatedMonthlyMin: 775,
          estimatedMonthlyMax: 895,
          baseRentMin: 765,
          baseRentMax: 885,
          deposit: 700,
          variableReimbursements: ['Electric', 'Gas', 'Other', 'Trash'],
        },
      },
    } as any;

    const details = resolveBuildingDetails(result);
    expect(details!.floorPlans[0].minPrice).toBe(775);
    expect(details!.floorPlans[0].maxPrice).toBe(895);
    expect(details!.floorPlans[0].minBaseRent).toBe(765);
    expect(details!.floorPlans[0].maxBaseRent).toBe(885);
    expect(details!.rentalCostCalculator!.deposit).toBe(700);
    expect(details!.rentalCostCalculator!.variableReimbursements).toEqual([
      'Electric',
      'Gas',
      'Other',
      'Trash',
    ]);
  });

  it('does not invent missing fields when the calculator is absent', () => {
    const result = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      market: 'US',
      buildingDetails: {
        availableUnitCount: 2,
        identifiedUnitCount: 2,
        availableUnits: [{ unitNumber: 'A1' }, { unitNumber: 'A2' }],
        floorPlanSummaries: [],
        rentalCostCalculator: null,
      },
    } as any;

    const details = resolveBuildingDetails(result);
    expect(details!.rentalCostCalculator).toBeNull();
    // No fee inference — never a synthesized requiredMonthlyFee value.
    expect(details!.floorPlanRollupFeeMin).toBeNull();
    expect(details!.floorPlanRollupFeeMax).toBeNull();
  });

  it('does not collapse duplicate area entries across batches in the underlying merge', async () => {
    // Re-validate via a smoke test that the merge module does not lose
    // observation entries when multiple spaceTypes share a name across batches.
    const { mergeVisualAnalysis } = await import(
      '../../../supabase/functions/analyze/mergeVisualAnalysis'
    );
    const merged = mergeVisualAnalysis([
      {
        photos: [{ photoIndex: 0 }],
        spaceAnalysis: [
          { spaceType: 'kitchen', observations: ['white cabinets'], score: 80 },
        ],
        photoReview: { areas: [{ area: 'kitchen', photoCount: 2 }] },
      },
      {
        photos: [{ photoIndex: 1 }],
        spaceAnalysis: [
          { spaceType: 'kitchen', observations: ['stone counter'], score: 60 },
        ],
        photoReview: { areas: [{ area: 'kitchen', photoCount: 1 }] },
      },
    ]);
    expect(merged.spaceAnalysis.length).toBe(1);
    const kitchen = merged.spaceAnalysis[0] as {
      observations: string[];
      score: number;
    };
    expect(kitchen.observations).toEqual(['white cabinets', 'stone counter']);
  });

  it('passes through parking "Varies" verbatim without inference', () => {
    const result = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      buildingDetails: {
        availableUnitCount: 0,
        identifiedUnitCount: 0,
        availableUnits: [],
        floorPlanSummaries: [],
        rentalCostCalculator: null,
        parking: 'Varies',
      },
    } as any;
    const details = resolveBuildingDetails(result);
    expect(details!.parking!.raw).toBe('Varies');
    expect(details!.parking!.isNone).toBeNull();
  });

  it('passes through parking "None" verbatim and surfaces isNone=true', () => {
    const result = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      buildingDetails: {
        availableUnitCount: 0,
        identifiedUnitCount: 0,
        availableUnits: [],
        floorPlanSummaries: [],
        rentalCostCalculator: null,
        parking: 'No parking available',
      },
    } as any;
    const details = resolveBuildingDetails(result);
    expect(details!.parking!.raw).toBe('No parking available');
    expect(details!.parking!.isNone).toBe(true);
  });

  it('preserves special offers as separate items without concatenating', () => {
    const result = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      buildingDetails: {
        availableUnitCount: 0,
        identifiedUnitCount: 0,
        availableUnits: [],
        floorPlanSummaries: [],
        rentalCostCalculator: null,
        specialOfferText: 'Apply within 24 hours → 4 weeks free',
        specialOffers: [
          '4 weeks free',
          '$25 Uber Eats gift card after in-person tour',
        ],
      },
    } as any;
    const details = resolveBuildingDetails(result);
    expect(details!.specialOffers).toEqual([
      '4 weeks free',
      '$25 Uber Eats gift card after in-person tour',
    ]);
    expect(details!.specialOfferText).toBe(
      'Apply within 24 hours → 4 weeks free',
    );
  });

  it('does not synthesise requiredMonthlyFee from base/total delta', () => {
    const result = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      buildingDetails: {
        availableUnitCount: 0,
        identifiedUnitCount: 0,
        availableUnits: [],
        floorPlanSummaries: [
          {
            planName: 'Studio',
            unitCount: 1,
            minBaseRent: 765,
            maxBaseRent: 885,
          },
        ],
        rentalCostCalculator: {
          estimatedMonthlyMin: 775,
          estimatedMonthlyMax: 895,
          baseRentMin: 765,
          baseRentMax: 885,
        },
      },
    } as any;
    const details = resolveBuildingDetails(result);
    // No delta-based fee inference. The roll-up fees are simply absent.
    expect(details!.floorPlanRollupFeeMin).toBeNull();
    expect(details!.floorPlanRollupFeeMax).toBeNull();
  });
});
