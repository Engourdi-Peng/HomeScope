# Case #4: Sale Condo / Townhouse

## 页面身份

- **URL**: TBD — pick a real Zillow `homedetails` listing for a condo
  or townhouse currently for sale
- **页面类型**: sale-condo-or-townhouse
- **listingScope**: `single_property`
- **reportMode**: `sale`
- **Verified Date**: _TBD_
- **Last Verified By**: _TBD_

## Page Facts

> To be filled on first human walk.

### Pricing
- Asking price: …
- HOA: … (typically non-zero for condos)
- Monthly payment (if shown): …

### Property facts
- Bedrooms: …
- Bathrooms: …
- Sqft: …
- Year built: …

### Photos
- Gallery: ≥ N 张

## Current HomeScope Status

### Known bugs in current extractor
- TBD

### Known correct outputs
- `listingScope` resolves to `single_property`
- `reportMode` resolves to `sale`
- HOA recognized as a fee (not as rent)
- No Rent-only fields

## Structural Facts Checklist

- [ ] `listingScope` resolves to `single_property`
- [ ] `reportMode` resolves to `sale`
- [ ] HOA treated as a fee (not as rent)
- [ ] No `Rent`-only fields populated
- [ ] Gallery complete

## Dynamic Facts

- Current asking price
- Current HOA amount
- Current days on market