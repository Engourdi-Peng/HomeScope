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

export const NO_USABLE_MULTI_UNIT_DATA_MESSAGE =
  'No usable multi-unit building data was extracted. Open or select a specific unit before generating a report.';

/**
 * Guard against submitting a multi-unit building page that has neither
 * unit data nor floor-plan data for analysis.
 *
 * Submission MUST be rejected, no analyze request sent, no credit deducted.
 *
 * v7 (2026-08-13): relax building-level requirements. The guard now only
 * blocks when BOTH `availableUnits` and `floorPlanSummaries` are empty/missing.
 * A multi_unit_building payload is allowed when ANY of:
 *   - availableUnits non-empty
 *   - floorPlanSummaries non-empty
 *
 * buildingName / buildingAddress / top-level monthlyRent / bedrooms /
 * bathrooms / sqft are NOT required. The Zillow building overview page
 * already supplies enough unit data and gallery images for the backend
 * to attempt a building-level report.
 *
 * For non-multi_unit_building listings, the guard never blocks (defensive
 * fallback for missing listingScope with many units was removed because
 * the frontend never sets availableUnits without also setting listingScope).
 */
export function getMultiUnitBuildingBlock(
  data: SubmitGuardInput | null | undefined,
): MultiUnitBlockResult {
  if (!data) return { blocked: false };
  const scope = data.listingScope;
  const units = data.availableUnits;
  if (scope === 'multi_unit_building') {
    const hasAvailableUnits = Array.isArray(units) && units.length > 0;
    const hasPlans = Array.isArray(data.floorPlanSummaries)
      && data.floorPlanSummaries.length > 0;
    if (hasAvailableUnits || hasPlans) {
      return { blocked: false };
    }
    return { blocked: true, message: NO_USABLE_MULTI_UNIT_DATA_MESSAGE };
  }
  return { blocked: false };
}
