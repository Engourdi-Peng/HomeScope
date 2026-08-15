# Case #2: Building + Selected Specific Unit (Winbro with `?bedroom=...&unit=...`)

## 页面身份

- **URL**: TBD (typically Winbro with a unit selected in the URL)
- **页面类型**: building-with-selected-unit
- **listingScope**: `selected_unit` (this is a building page, but with a
  specific concrete unit pinned — distinct from the building overview)
- **reportMode**: `rent`
- **Verified Date**: _TBD_
- **Last Verified By**: _TBD_

## Page Facts

> To be filled on first human walk.

### Pricing
- floorPlanSummaries: …
- availableUnits (selected one): …
- advertised range: …

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
- `selectedUnit` should resolve to the pinned concrete unit
- `listingScope` correctly reports `selected_unit` (not
  `multi_unit_building`)
- `availableUnits` length should typically be 1 (the pinned unit)

## Structural Facts Checklist

- [ ] `listingScope` resolves to `selected_unit` (NOT `multi_unit_building`)
- [ ] Pinned unit is the one returned in `availableUnits`
- [ ] `floorPlanSummaries` still present (the building context is not
      lost just because a unit is selected)
- [ ] `totalAvailableUnitCount` still equals the building-wide count
- [ ] `identifiedUnitCount` is 1 (or whatever the page lists)
- [ ] No `Sale`-only fields appear
- [ ] Gallery complete

## Dynamic Facts

- Current pinned unit number
- Current pinned unit price
- Other units in the building (for cross-check)