import { describe, it, expect } from 'vitest';
import { resolveBuildingDetails } from './buildingDetails';

/**
 * Winbro 1620 N Grant St, Denver, CO 80203
 * https://www.zillow.com/apartments/denver-co/winbro/ngrxxw/
 *
 * Source-of-truth shape mirrors what the analyze function writes into
 * `result.buildingDetails` for `reportMode === 'rent' && listingScope ===
 * 'multi_unit_building'` — see
 *   supabase/functions/analyze/index.ts (~L9477..L9506)
 *
 * Facts come from docs/zillow-golden-cases/01-multi-unit-building-winbro.md
 * and the extension payload audited in this change.
 *
 * NOTE: Winbro is used here ONLY as a regression fixture for the generic
 * multi-unit building rent pipeline. The values asserted below exercise
 * the same resolver that other Zillow Building Rent listings will use.
 */
const winbroBuildingDetails = {
  buildingName: null,
  buildingAddress: '1620 N Grant St, Denver, CO 80203',
  buildingId: 'ngrxxw',
  unitNumber: '504',
  availableUnitCount: 3,
  identifiedUnitCount: 1,
  availableUnits: [
    {
      unitId: '504',
      unitNumber: '504',
      bedrooms: 0,
      bathrooms: 1,
      sqft: 325,
      monthlyRent: 855,
      availableFrom: 'Available Now',
      photoCount: 7,
    },
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
      requiredMonthlyFeeMin: 5,
      requiredMonthlyFeeMax: 10,
      listPriceIncludesRequiredMonthlyFees: true,
      availableFrom: '0',
      leaseTerm: '12-month lease',
    },
  ],
  rentalCostCalculator: {
    estimatedMonthlyMin: 775,
    estimatedMonthlyMax: 895,
    baseRentMin: 765,
    baseRentMax: 885,
    applicationCost: 50,
    holdingCost: 165,
    totalApplicationCost: 215,
    deposit: 700,
    depositRefundable: true,
    totalMoveInCost: 700,
    variableReimbursements: ['Electric', 'Gas', 'Other', 'Trash'],
  },
  parking: 'None',
  leaseTerm: '12-month lease',
  specialOfferText:
    'Apply within 24 hours of tour and move in by 8/15 → 4 weeks free',
  specialOffers: [
    '4 weeks free',
    '$25 Uber Eats gift card after in-person tour',
  ],
};

const winbroResult = {
  reportMode: 'rent',
  listingScope: 'multi_unit_building',
  market: 'US',
  analysisType: 'full',
  buildingDetails: winbroBuildingDetails,
} as any;

describe('resolveBuildingDetails — Winbro Golden Case', () => {
  const details = resolveBuildingDetails(winbroResult);

  it('resolves a non-null BuildingDetailsView for Winbro', () => {
    expect(details).not.toBeNull();
    expect(details!.listingScope).toBe('multi_unit_building');
  });

  it('surfaces availableUnitCount and identifiedUnitCount verbatim', () => {
    expect(details!.availableUnitCount).toBe(3);
    expect(details!.identifiedUnitCount).toBe(1);
  });

  it('exposes the identified Unit 504 with sqft and rent', () => {
    expect(details!.availableUnits).toHaveLength(1);
    const unit = details!.availableUnits[0];
    expect(unit.unitNumber).toBe('504');
    expect(unit.bedrooms).toBe(0);
    expect(unit.bathrooms).toBe(1);
    expect(unit.sqft).toBe(325);
    expect(unit.monthlyRent).toBe(855);
    expect(unit.availableFrom).toBe('Available Now');
    expect(unit.photoCount).toBe(7);
  });

  it('preserves floor plan roll-up as $775–$895 advertised, $765–$885 base', () => {
    expect(details!.floorPlans).toHaveLength(1);
    const fp = details!.floorPlans[0];
    expect(fp.planName).toBe('Studio');
    expect(fp.unitCount).toBe(3);
    expect(fp.minPrice).toBe(775);
    expect(fp.maxPrice).toBe(895);
    expect(fp.minBaseRent).toBe(765);
    expect(fp.maxBaseRent).toBe(885);
    expect(fp.requiredMonthlyFeeMin).toBe(5);
    expect(fp.requiredMonthlyFeeMax).toBe(10);
    expect(fp.listPriceIncludesRequiredMonthlyFees).toBe(true);
    expect(fp.leaseTerm).toBe('12-month lease');
  });

  it('exposes the rental cost calculator upfront numbers', () => {
    const calc = details!.rentalCostCalculator!;
    expect(calc.applicationCost).toBe(50);
    expect(calc.holdingCost).toBe(165);
    expect(calc.totalApplicationCost).toBe(215);
    expect(calc.estimatedMonthlyMin).toBe(775);
    expect(calc.estimatedMonthlyMax).toBe(895);
    expect(calc.baseRentMin).toBe(765);
    expect(calc.baseRentMax).toBe(885);
    expect(calc.deposit).toBe(700);
    expect(calc.depositRefundable).toBe(true);
    expect(calc.totalMoveInCost).toBe(700);
  });

  it('exposes variable reimbursements verbatim', () => {
    expect(details!.rentalCostCalculator!.variableReimbursements).toEqual([
      'Electric',
      'Gas',
      'Other',
      'Trash',
    ]);
  });

  it('exposes the special-offer block verbatim (no discount rewriting)', () => {
    expect(details!.specialOfferText).toBe(
      'Apply within 24 hours of tour and move in by 8/15 → 4 weeks free',
    );
    expect(details!.specialOffers).toEqual([
      '4 weeks free',
      '$25 Uber Eats gift card after in-person tour',
    ]);
  });

  it('preserves explicit parking "None" without synthesising confirm prompts', () => {
    expect(details!.parking).not.toBeNull();
    expect(details!.parking!.raw).toBe('None');
    expect(details!.parking!.isNone).toBe(true);
    expect(details!.leaseTerm).toBe('12-month lease');
  });

  it('does not synthesise fallback values when fields are missing', () => {
    const partial = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      buildingDetails: {
        availableUnitCount: 0,
        identifiedUnitCount: 0,
        availableUnits: [],
        floorPlanSummaries: [],
        rentalCostCalculator: null,
        parking: null,
        leaseTerm: null,
        specialOfferText: null,
        specialOffers: null,
      },
    } as any;
    const out = resolveBuildingDetails(partial);
    expect(out).not.toBeNull();
    expect(out!.rentalCostCalculator).toBeNull();
    expect(out!.parking).toBeNull();
    expect(out!.leaseTerm).toBeNull();
    expect(out!.availableUnits).toEqual([]);
    expect(out!.floorPlans).toEqual([]);
    expect(out!.specialOffers).toEqual([]);
    expect(out!.baseRent).toBeNull();
  });
});

describe('resolveBuildingDetails — Generic multi-unit rental coverage', () => {
  it('passes through known parking values verbatim (Varies)', () => {
    const partial = {
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
    const out = resolveBuildingDetails(partial);
    expect(out!.parking!.raw).toBe('Varies');
    expect(out!.parking!.isNone).toBeNull();
  });

  it('keeps unit rows even when sqft/photoCount/availableFrom are missing', () => {
    const partial = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      buildingDetails: {
        availableUnitCount: 2,
        identifiedUnitCount: 2,
        availableUnits: [
          { unitNumber: '103', monthlyRent: 775, availableFrom: 'Aug 14' },
          { unitNumber: '210', monthlyRent: 895, availableFrom: 'Aug 24' },
        ],
        floorPlanSummaries: [],
        rentalCostCalculator: null,
      },
    } as any;
    const out = resolveBuildingDetails(partial);
    expect(out!.availableUnits).toHaveLength(2);
    expect(out!.availableUnits[0].unitNumber).toBe('103');
    expect(out!.availableUnits[1].unitNumber).toBe('210');
    expect(out!.availableUnits[0].photoCount).toBeNull();
    expect(out!.availableUnits[1].sqft).toBeNull();
  });

  it('depositRefundable boolean is preserved when truthy or falsy', () => {
    const partial = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
      buildingDetails: {
        availableUnitCount: 0,
        identifiedUnitCount: 0,
        availableUnits: [],
        floorPlanSummaries: [],
        rentalCostCalculator: { deposit: 1000, depositRefundable: false },
      },
    } as any;
    const out = resolveBuildingDetails(partial);
    expect(out!.rentalCostCalculator!.deposit).toBe(1000);
    expect(out!.rentalCostCalculator!.depositRefundable).toBe(false);
  });
});
