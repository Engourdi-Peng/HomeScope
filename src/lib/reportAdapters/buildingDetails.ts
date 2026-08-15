/**
 * Resolve Multi-Unit Building Rent details from the raw report payload.
 *
 * `result.buildingDetails` is populated by the analyze function for the
 * `reportMode === 'rent' && listingScope === 'multi_unit_building'` branch and
 * mirrors the structured facts the extension extracted (availableUnits,
 * floorPlanSummaries, rentalCostCalculator, specialOffers, …). This adapter
 * is intentionally narrow: it only exposes fields that already exist in the
 * payload and never synthesises fallback values.
 */
import type { AnalysisResult } from '../../types';

export type BuildingAvailableUnit = {
  unitId?: string | null;
  unitNumber?: string | null;
  name?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  monthlyRent?: number | null;
  availableFrom?: string | null;
  photoCount?: number | null;
};

export type BuildingFloorPlan = {
  planName?: string | null;
  name?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  unitCount?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minBaseRent?: number | null;
  maxBaseRent?: number | null;
  requiredMonthlyFeeMin?: number | null;
  requiredMonthlyFeeMax?: number | null;
  listPriceIncludesRequiredMonthlyFees?: boolean | null;
  availableFrom?: string | null;
  leaseTerm?: string | null;
};

export type BuildingRentalCostCalculator = {
  estimatedMonthlyMin?: number | null;
  estimatedMonthlyMax?: number | null;
  baseRentMin?: number | null;
  baseRentMax?: number | null;
  applicationCost?: number | null;
  holdingCost?: number | null;
  totalApplicationCost?: number | null;
  deposit?: number | null;
  /** Whether the deposit is refundable. Preserves explicit facts — never inferred. */
  depositRefundable?: boolean | null;
  totalMoveInCost?: number | null;
  variableReimbursements?: string[] | null;
};

export type BuildingParking = {
  /** String value preserving explicit "None" / "Varies" / specific count etc. */
  raw?: string | null;
  /** Convenience boolean when the raw value clearly implies no parking. */
  isNone?: boolean | null;
};

export type BuildingDetailsView = {
  listingScope: 'multi_unit_building';
  buildingName?: string | null;
  buildingAddress?: string | null;
  unitNumber?: string | null;
  availableUnitCount: number;
  identifiedUnitCount: number;
  floorPlans: BuildingFloorPlan[];
  availableUnits: BuildingAvailableUnit[];
  rentalCostCalculator: BuildingRentalCostCalculator | null;
  parking: BuildingParking | null;
  leaseTerm?: string | null;
  petPolicy?: string | null;
  laundry?: string | null;
  specialOfferText: string | null;
  specialOffers: string[];
  floorPlanRollupFeesIncluded: boolean | null;
  floorPlanRollupFeeMin: number | null;
  floorPlanRollupFeeMax: number | null;
  baseRent: number | null;
};

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v != null) as T[];
}

export function resolveBuildingDetails(
  result: AnalysisResult | Record<string, unknown> | null | undefined,
): BuildingDetailsView | null {
  if (!result) return null;
  const raw = result as Record<string, unknown>;
  const meta = (raw.meta as Record<string, unknown> | undefined) ?? undefined;
  const reportMode =
    (raw.reportMode as string | undefined) ?? meta?.reportMode ?? undefined;
  const listingScope =
    (raw.listingScope as string | undefined) ?? meta?.listingScope ?? undefined;

  if (reportMode !== 'rent' || listingScope !== 'multi_unit_building') {
    return null;
  }

  const buildingDetails = raw.buildingDetails as
    | Record<string, unknown>
    | null
    | undefined;
  if (!buildingDetails || typeof buildingDetails !== 'object') return null;

  const rawFloorPlans = asArray<Record<string, unknown>>(
    buildingDetails.floorPlanSummaries,
  );
  const rawAvailableUnits = asArray<Record<string, unknown>>(
    buildingDetails.availableUnits,
  );
  const rawCalculator = (buildingDetails.rentalCostCalculator as
    | Record<string, unknown>
    | null
    | undefined) ?? null;

  const floorPlans: BuildingFloorPlan[] = rawFloorPlans.map((fp) => ({
    planName: (fp.planName as string | null | undefined) ?? null,
    name: (fp.name as string | null | undefined) ?? null,
    bedrooms: asNumber(fp.bedrooms ?? fp.beds),
    bathrooms: asNumber(fp.bathrooms ?? fp.baths),
    sqft: asNumber(fp.sqft),
    unitCount: asNumber(fp.unitCount),
    minPrice: asNumber(fp.minPrice ?? fp.priceMin),
    maxPrice: asNumber(fp.maxPrice ?? fp.priceMax),
    minBaseRent: asNumber(fp.minBaseRent),
    maxBaseRent: asNumber(fp.maxBaseRent),
    requiredMonthlyFeeMin: asNumber(fp.requiredMonthlyFeeMin),
    requiredMonthlyFeeMax: asNumber(fp.requiredMonthlyFeeMax),
    listPriceIncludesRequiredMonthlyFees: asBoolean(
      fp.listPriceIncludesRequiredMonthlyFees,
    ),
    availableFrom: (fp.availableFrom as string | null | undefined) ?? null,
    leaseTerm: (fp.leaseTerm as string | null | undefined) ?? null,
  }));

  const availableUnits: BuildingAvailableUnit[] = rawAvailableUnits.map(
    (unit) => ({
      unitId: (unit.unitId as string | null | undefined) ?? null,
      unitNumber: (unit.unitNumber as string | null | undefined) ?? null,
      name: (unit.name as string | null | undefined) ?? null,
      bedrooms: asNumber(unit.bedrooms ?? unit.beds),
      bathrooms: asNumber(unit.bathrooms ?? unit.baths),
      sqft: asNumber(unit.sqft),
      monthlyRent: asNumber(unit.monthlyRent ?? unit.rent),
      availableFrom: (unit.availableFrom as string | null | undefined) ?? null,
      photoCount: asNumber(unit.photoCount),
    }),
  );

  const rentalCostCalculator: BuildingRentalCostCalculator | null = rawCalculator
    ? {
        estimatedMonthlyMin: asNumber(rawCalculator.estimatedMonthlyMin),
        estimatedMonthlyMax: asNumber(rawCalculator.estimatedMonthlyMax),
        baseRentMin: asNumber(rawCalculator.baseRentMin),
        baseRentMax: asNumber(rawCalculator.baseRentMax),
        applicationCost: asNumber(rawCalculator.applicationCost),
        holdingCost: asNumber(rawCalculator.holdingCost),
        totalApplicationCost: asNumber(rawCalculator.totalApplicationCost),
        deposit: asNumber(rawCalculator.deposit),
        depositRefundable: (() => {
          const v = rawCalculator.depositRefundable;
          if (v === true || v === false) return v;
          if (v === 'true') return true;
          if (v === 'false') return false;
          return null;
        })(),
        totalMoveInCost: asNumber(rawCalculator.totalMoveInCost),
        variableReimbursements: Array.isArray(
          rawCalculator.variableReimbursements,
        )
          ? (rawCalculator.variableReimbursements as unknown[])
              .filter((v) => typeof v === 'string' && v.length > 0)
              .map((v) => String(v))
          : null,
      }
    : null;

  // Parking: preserve explicit "None" / "Varies" / specific count etc. as raw,
  // and derive isNone only when the raw value clearly communicates no parking.
  const rawParking = (buildingDetails as Record<string, unknown>).parking;
  const parkingStr =
    typeof rawParking === 'string'
      ? rawParking
      : rawParking == null
      ? null
      : String(rawParking);
  const parking: BuildingParking | null = parkingStr
    ? {
        raw: parkingStr,
        isNone:
          /\b(none|no\s*parking|not\s*included|0\s*spaces?)\b/i.test(parkingStr)
            ? true
            : null,
      }
    : null;

  const leaseTerm = (() => {
    const v = (buildingDetails as Record<string, unknown>).leaseTerm;
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  })();
  const petPolicy = (() => {
    const v = (buildingDetails as Record<string, unknown>).petPolicy;
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  })();
  const laundry = (() => {
    const v = (buildingDetails as Record<string, unknown>).laundry;
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  })();

  return {
    listingScope: 'multi_unit_building',
    buildingName:
      (buildingDetails.buildingName as string | null | undefined) ?? null,
    buildingAddress:
      (buildingDetails.buildingAddress as string | null | undefined) ?? null,
    unitNumber:
      (buildingDetails.unitNumber as string | null | undefined) ?? null,
    availableUnitCount: asNumber(buildingDetails.availableUnitCount) ?? 0,
    identifiedUnitCount:
      asNumber(buildingDetails.identifiedUnitCount) ??
      asNumber(buildingDetails.availableUnitCount) ??
      0,
    floorPlans,
    availableUnits,
    rentalCostCalculator,
    parking,
    leaseTerm,
    petPolicy,
    laundry,
    specialOfferText:
      (buildingDetails.specialOfferText as string | null | undefined) ?? null,
    specialOffers: Array.isArray(buildingDetails.specialOffers)
      ? (buildingDetails.specialOffers as unknown[])
          .filter((v) => typeof v === 'string' && v.length > 0)
          .map((v) => String(v))
      : [],
    floorPlanRollupFeesIncluded: asBoolean(
      buildingDetails.listPriceIncludesRequiredMonthlyFees,
    ),
    floorPlanRollupFeeMin: asNumber(
      buildingDetails.requiredMonthlyFeeMin,
    ),
    floorPlanRollupFeeMax: asNumber(
      buildingDetails.requiredMonthlyFeeMax,
    ),
    baseRent: asNumber(buildingDetails.baseRent),
  };
}
