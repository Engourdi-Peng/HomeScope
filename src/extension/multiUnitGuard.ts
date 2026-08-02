/**
 * Pure helpers used by the extension store submission guard.
 * Kept in their own module so they can be unit-tested without importing
 * the full store / chrome runtime.
 */

export interface SubmitGuardInput {
  listingScope?: string;
  availableUnits?: unknown[] | null;
  floorPlanSummaries?: unknown[] | null;
  buildingName?: string | null;
  buildingAddress?: string | null;
  monthlyRent?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  reportMode?: 'rent' | 'sale';
  listingType?: 'rent' | 'sale' | 'unknown';
}

export interface MultiUnitBlockResult {
  blocked: boolean;
  message?: string;
}

export const MULTI_UNIT_MESSAGE =
  'This building has multiple available units. Open or select a specific unit before generating a report.';

/**
 * Refuse to submit multi-unit building overview pages for analysis.
 *
 * Submission MUST be rejected, no analyze request sent, no credit deducted.
 *
 * Triggers (any one):
 *   - listingScope === 'multi_unit_building' AND complete building-level data is missing
 *   - availableUnits.length > 1 and listingScope is missing (defensive)
 *
 * v6 (2026-08-02): allow complete building-level data through.
 * A multi_unit_building payload is allowed when ALL of:
 *   - buildingName OR buildingAddress present
 *   - floorPlanSummaries non-empty
 *   - top-level monthlyRent / bedrooms / bathrooms / sqft are all null
 * (empty availableUnits is allowed; floorPlanSummaries carries the unit-type info)
 */
export function getMultiUnitBuildingBlock(
  data: SubmitGuardInput | null | undefined,
): MultiUnitBlockResult {
  if (!data) return { blocked: false };
  const scope = data.listingScope;
  const units = data.availableUnits;
  if (scope === 'multi_unit_building') {
    const hasIdentity = !!data.buildingName || !!data.buildingAddress;
    const hasPlans = Array.isArray(data.floorPlanSummaries)
      && data.floorPlanSummaries.length > 0;
    const topLevelAllNull = data.monthlyRent == null
      && data.bedrooms == null
      && data.bathrooms == null
      && data.sqft == null;
    if (hasIdentity && hasPlans && topLevelAllNull) {
      return { blocked: false };
    }
    return { blocked: true, message: MULTI_UNIT_MESSAGE };
  }
  if (Array.isArray(units) && units.length > 1 && !scope) {
    return { blocked: true, message: MULTI_UNIT_MESSAGE };
  }
  return { blocked: false };
}
