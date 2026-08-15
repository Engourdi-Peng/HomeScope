/**
 * Resolve the report variant for a listing.
 *
 * Currently the only specialised variant is `rent_building`, triggered when
 * the listing is a US Rent multi-unit building page. All other combinations
 * fall through to the unified report path (`default`) — including Sale, Rent
 * single_property, Rent private_room, etc.
 */

export type ReportVariant =
  | 'rent_building'
  | 'default';

export function resolveReportVariant({
  reportMode,
  listingScope,
}: {
  reportMode?: string | null;
  listingScope?: string | null;
}): ReportVariant {
  if (
    typeof reportMode === 'string' &&
    reportMode.toLowerCase() === 'rent' &&
    listingScope === 'multi_unit_building'
  ) {
    return 'rent_building';
  }
  return 'default';
}
