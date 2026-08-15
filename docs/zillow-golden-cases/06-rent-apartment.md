# Case #6: Rent Apartment (building page, no specific unit selected)

## 页面身份

- **URL**: TBD — pick a real Zillow `apartments` listing for a rent
  apartment building, distinct from Winbro
- **页面类型**: rent-apartment
- **listingScope**: `multi_unit_building`
- **reportMode**: `rent`
- **Verified Date**: _TBD_
- **Last Verified By**: _TBD_

> If this case has a `rentalCostCalculator`, it serves as a positive
> control for the Winbro case (Case #1) where the calculator is
> currently broken.

## Page Facts

> To be filled on first human walk.

### Pricing
- `floorPlanSummaries`: …
- `availableUnits`: …

### specialOffer
- …

### rentalCostCalculator
- …

### Photos
- Gallery: ≥ N 张

## Current HomeScope Status

### Known bugs in current extractor
- TBD

### Known correct outputs
- `listingScope` resolves to `multi_unit_building`
- `reportMode` resolves to `rent`
- `floorPlanSummaries` and `availableUnits` semantically split

## Structural Facts Checklist

- [ ] `listingScope` resolves to `multi_unit_building`
- [ ] `reportMode` resolves to `rent`
- [ ] `floorPlanSummaries` and `availableUnits` semantically split
- [ ] `totalAvailableUnitCount` and `identifiedUnitCount` do not
      fallback to each other
- [ ] No Sale-only fields
- [ ] Gallery complete

## Dynamic Facts

- Current `floorPlanSummaries`
- Current `availableUnits`
- Current `rentalCostCalculator` (if any)
- Current `specialOffer` (if any)