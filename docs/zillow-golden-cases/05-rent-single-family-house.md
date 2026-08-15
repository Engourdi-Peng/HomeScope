# Case #5: Rent Single-Family House

## 页面身份

- **URL**: TBD — pick a real Zillow `homedetails` listing for a single
  family house currently for rent
- **页面类型**: rent-single-family-house
- **listingScope**: `single_property`
- **reportMode**: `rent`
- **Verified Date**: _TBD_
- **Last Verified By**: _TBD_

## Page Facts

> To be filled on first human walk.

### Pricing
- Monthly rent: …
- Deposit (if shown): …
- Application fee (if shown): …

### Property facts
- Bedrooms: …
- Bathrooms: …
- Sqft: …

### Photos
- Gallery: ≥ N 张

## Current HomeScope Status

### Known bugs in current extractor
- TBD

### Known correct outputs
- `listingScope` resolves to `single_property`
- `reportMode` resolves to `rent`
- No Sale-only fields (no `askingPrice`)
- No `floorPlanSummaries` (this is a single property, not a building)
- No `rentalCostCalculator` (typically single-property rents don't have
  one)

## Structural Facts Checklist

- [ ] `listingScope` resolves to `single_property`
- [ ] `reportMode` resolves to `rent`
- [ ] No Sale-only fields populated
- [ ] No `floorPlanSummaries` (single property, not building)
- [ ] No `availableUnits` (single property, not building)
- [ ] Gallery complete

## Dynamic Facts

- Current monthly rent
- Current deposit / application fee (if shown)
- Current availability