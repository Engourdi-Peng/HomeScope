/**
 * Unit tests for the multi-unit building submission guard.
 *
 * Contract (v7, 2026-08-13):
 *  - listingScope === 'multi_unit_building' is allowed as long as the payload
 *    carries SOME usable data: non-empty availableUnits OR non-empty
 *    floorPlanSummaries. buildingName / buildingAddress / top-level unit
 *    fields are no longer required.
 *  - When both availableUnits and floorPlanSummaries are empty/missing, the
 *    guard MUST block submission with the data-missing message.
 *  - Single-unit / selected-unit / entire-home / private-room pages MUST pass.
 *  - Sale and rent listings are unaffected by the guard.
 */
import { describe, expect, it } from 'vitest';

import {
  getMultiUnitBuildingBlock,
  NO_USABLE_MULTI_UNIT_DATA_MESSAGE,
} from '../../extension/multiUnitGuard';

describe('multiUnitBuildingBlock guard', () => {
  it('passes when listingScope is multi_unit_building with availableUnits', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'multi_unit_building',
      availableUnits: [{}],
    });
    expect(result.blocked).toBe(false);
  });

  it('passes when listingScope is missing but multiple units are present', () => {
    const result = getMultiUnitBuildingBlock({
      availableUnits: [{}, {}, {}],
    });
    expect(result.blocked).toBe(false);
  });

  it('passes for selected_unit', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'selected_unit',
      availableUnits: [{}],
    });
    expect(result.blocked).toBe(false);
  });

  it('passes when scope missing and only a single unit', () => {
    const result = getMultiUnitBuildingBlock({ availableUnits: [{}] });
    expect(result.blocked).toBe(false);
  });

  it('passes for null data', () => {
    expect(getMultiUnitBuildingBlock(null).blocked).toBe(false);
    expect(getMultiUnitBuildingBlock(undefined).blocked).toBe(false);
  });

  it('passes for entire_home', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'entire_home',
      availableUnits: undefined,
    });
    expect(result.blocked).toBe(false);
  });

  it('passes for private_room', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'private_room',
    });
    expect(result.blocked).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────
  // v7 contract:
  //   listingScope === 'multi_unit_building'
  //   allowed when availableUnits or floorPlanSummaries is non-empty.
  // ─────────────────────────────────────────────────────────────────────

  it('passes for multi_unit_building with availableUnits only (no floorPlanSummaries, no identity)', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'multi_unit_building',
      reportMode: 'rent',
      availableUnits: [
        { unitNumber: '509', unitId: 'unit-509', monthlyRent: 855 },
        { unitNumber: '510', unitId: 'unit-510', monthlyRent: 870 },
      ],
      floorPlanSummaries: null,
      buildingName: null,
      buildingAddress: null,
    });
    expect(result.blocked).toBe(false);
  });

  it('passes for the real Zillow building payload (15 units, no floor plans, no identity)', () => {
    const availableUnits = Array.from({ length: 15 }, (_, i) => ({
      unitNumber: String(100 + i),
      unitId: `unit-${100 + i}`,
      monthlyRent: 1500 + i * 10,
    }));
    const result = getMultiUnitBuildingBlock({
      listingScope: 'multi_unit_building',
      reportMode: 'rent',
      availableUnits,
      floorPlanSummaries: null,
      buildingName: false as any,
      buildingAddress: false as any,
      monthlyRent: null,
      bedrooms: null,
      bathrooms: null,
      sqft: null,
    });
    expect(result.blocked).toBe(false);
  });

  it('passes for multi_unit_building with floorPlanSummaries only (no availableUnits)', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'multi_unit_building',
      reportMode: 'rent',
      availableUnits: [],
      floorPlanSummaries: [
        {
          planName: 'Studio',
          bedrooms: 0,
          bathrooms: 1,
          sqft: 480,
          minPrice: 775,
          maxPrice: 895,
          unitCount: 4,
        },
      ],
    });
    expect(result.blocked).toBe(false);
  });

  it('blocks multi_unit_building when both availableUnits and floorPlanSummaries are empty', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'multi_unit_building',
      reportMode: 'rent',
      availableUnits: [],
      floorPlanSummaries: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.message).toBe(NO_USABLE_MULTI_UNIT_DATA_MESSAGE);
  });

  it('blocks multi_unit_building when availableUnits and floorPlanSummaries are both null', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'multi_unit_building',
      reportMode: 'rent',
      availableUnits: null,
      floorPlanSummaries: null,
    });
    expect(result.blocked).toBe(true);
    expect(result.message).toBe(NO_USABLE_MULTI_UNIT_DATA_MESSAGE);
  });

  it('blocks multi_unit_building when availableUnits and floorPlanSummaries are missing entirely', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'multi_unit_building',
      reportMode: 'rent',
    });
    expect(result.blocked).toBe(true);
    expect(result.message).toBe(NO_USABLE_MULTI_UNIT_DATA_MESSAGE);
  });

  it('passes for rent sale listings even with many units (guard only acts on multi_unit_building)', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'rent_building',
      reportMode: 'rent',
      availableUnits: [{}, {}, {}, {}],
    });
    expect(result.blocked).toBe(false);
  });
});
