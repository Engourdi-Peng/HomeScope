import { describe, it, expect } from 'vitest';
import { resolveBuildingDetails } from './buildingDetails';
import { resolveReportVariant } from './reportVariant';

describe('resolveReportVariant — Building Rent routing', () => {
  it('returns rent_building only for rent + multi_unit_building', () => {
    expect(
      resolveReportVariant({
        reportMode: 'rent',
        listingScope: 'multi_unit_building',
      }),
    ).toBe('rent_building');
  });

  it('returns default for Sale (multi_unit_building does not apply)', () => {
    expect(
      resolveReportVariant({
        reportMode: 'sale',
        listingScope: 'multi_unit_building',
      }),
    ).toBe('default');
  });

  it('returns default for Rent single_property / private_room / selected_unit', () => {
    for (const scope of [
      'single_property',
      'entire_home',
      'private_room',
      'selected_unit',
      'unknown',
    ]) {
      expect(
        resolveReportVariant({ reportMode: 'rent', listingScope: scope }),
      ).toBe('default');
    }
  });

  it('returns default for null/undefined inputs', () => {
    expect(resolveReportVariant({})).toBe('default');
    expect(
      resolveReportVariant({ reportMode: undefined, listingScope: undefined }),
    ).toBe('default');
  });
});

describe('resolveBuildingDetails — mode guards', () => {
  it('returns null for Sale results', () => {
    const result = {
      reportMode: 'sale',
      listingScope: 'multi_unit_building',
      buildingDetails: { availableUnitCount: 3 },
    } as any;
    expect(resolveBuildingDetails(result)).toBeNull();
  });

  it('returns null when listingScope is not multi_unit_building', () => {
    const result = {
      reportMode: 'rent',
      listingScope: 'single_property',
      buildingDetails: { availableUnitCount: 3 },
    } as any;
    expect(resolveBuildingDetails(result)).toBeNull();
  });

  it('returns null when buildingDetails is absent for an otherwise valid result', () => {
    const result = {
      reportMode: 'rent',
      listingScope: 'multi_unit_building',
    } as any;
    expect(resolveBuildingDetails(result)).toBeNull();
  });
});
