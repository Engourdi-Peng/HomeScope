/**
 * Unit tests for the multi-unit building submission guard.
 *
 * Contract:
 *  - When listingScope === 'multi_unit_building', submission MUST be blocked.
 *  - When >1 unit exists and scope is missing, submission MUST also be blocked
 *    (defensive fallback).
 *  - Single-unit / selected-unit / entire-home pages MUST pass.
 *  - The blocked message must be the exact product-mandated copy.
 */
import { describe, expect, it } from 'vitest';

import {
  getMultiUnitBuildingBlock,
  MULTI_UNIT_MESSAGE,
} from '../../extension/multiUnitGuard';

describe('multiUnitBuildingBlock guard', () => {
  it('blocks when listingScope is multi_unit_building', () => {
    const result = getMultiUnitBuildingBlock({
      listingScope: 'multi_unit_building',
      availableUnits: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.message).toBe(MULTI_UNIT_MESSAGE);
  });

  it('blocks when listingScope is missing but multiple units are present', () => {
    const result = getMultiUnitBuildingBlock({
      availableUnits: [{}, {}, {}],
    });
    expect(result.blocked).toBe(true);
    expect(result.message).toBe(MULTI_UNIT_MESSAGE);
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
});
