# Case #3: Sale Single-Family House

## 页面身份

- **URL**: TBD — pick a real Zillow `homedetails` listing for a single
  family house currently for sale
- **页面类型**: sale-single-family-house
- **listingScope**: `single_property`
- **reportMode**: `sale`
- **Verified Date**: _TBD_
- **Last Verified By**: _TBD_

## Page Facts

> To be filled on first human walk.

### Pricing
- Asking price: …
- Zestimate: …
- Monthly payment (if shown): …

### Property facts
- Bedrooms: …
- Bathrooms: …
- Sqft: …
- Lot size: …
- Year built: …

### HOA / Tax / Fees
- HOA: …
- Annual tax: …
- Other fees: …

### Photos
- Gallery: ≥ N 张

## Current HomeScope Status

### Known bugs in current extractor
- TBD

### Known correct outputs
- `listingScope` resolves to `single_property`
- `reportMode` resolves to `sale`
- No `Rent`-only fields appear (no `monthlyRent`, no
  `rentalCostCalculator`)
- Bedroom/bathroom/sqft pulled from structured data

## Structural Facts Checklist

- [ ] `listingScope` resolves to `single_property`
- [ ] `reportMode` resolves to `sale`
- [ ] No `Rent`-only fields populated
- [ ] Price fields populated
- [ ] Property facts (beds / baths / sqft) populated
- [ ] Gallery complete
- [ ] Nearby Apartments module does not leak in

## Dynamic Facts

- Current asking price
- Current days on market
- Current price reductions (if any)