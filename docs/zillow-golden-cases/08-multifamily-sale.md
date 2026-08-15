# Case #8: Multifamily Sale (duplex / triplex)

## 页面身份

- **URL**: TBD — pick a real Zillow `homedetails` listing for a
  multifamily (duplex / triplex / fourplex) currently for sale
- **页面类型**: multifamily-sale
- **listingScope**: `single_property` (the listing is a single parcel,
  even though the building contains multiple units)
- **reportMode**: `sale`
- **Verified Date**: _TBD_
- **Last Verified By**: _TBD_

> Watch out: the URL/domain shape overlaps with `single_property` sale,
> but the page has rent roll / unit-mix content that the extractor must
> not mistake for a `multi_unit_building` rent listing.

## Page Facts

> To be filled on first human walk.

### Pricing
- Asking price: …
- Rent roll (if shown): …
- Cap rate / GRM (if shown): …

### Property facts
- Total units: …
- Bedrooms / bathrooms per unit: …

### Photos
- Gallery: ≥ N 张

## Current HomeScope Status

### Known bugs in current extractor
- TBD

### Known correct outputs
- `listingScope` resolves to `single_property` (NOT
  `multi_unit_building`, even though the building contains multiple
  units — this is a Sale listing)
- `reportMode` resolves to `sale`
- No Rent-only fields populated

## Structural Facts Checklist

- [ ] `listingScope` resolves to `single_property` (NOT
      `multi_unit_building`)
- [ ] `reportMode` resolves to `sale`
- [ ] No `Rent`-only fields populated
- [ ] No `floorPlanSummaries` / `availableUnits` / `rentalCostCalculator`
      / `specialOfferText` (this is a Sale page, not Rent)
- [ ] Gallery complete

## Dynamic Facts

- Current asking price
- Current rent roll (if shown)
- Current days on market