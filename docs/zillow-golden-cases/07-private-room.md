# Case #7: Private Room (zillow.com/rooms/...)

## 页面身份

- **URL**: TBD — pick a real Zillow `rooms` listing
- **页面类型**: private-room
- **listingScope**: `private_room`
- **reportMode**: `rent`
- **Verified Date**: _TBD_
- **Last Verified By**: _TBD_

## Page Facts

> To be filled on first human walk.

### Pricing
- Monthly rent for the room: …
- Any utilities included: …

### Property facts
- Private room size (sqft): …
- Bathroom arrangement: …
- Furnished / unfurnished: …

### Photos
- Gallery: ≥ N 张

## Current HomeScope Status

### Known bugs in current extractor
- TBD

### Known correct outputs
- `listingScope` resolves to `private_room` (this is distinct from
  `single_property` and `multi_unit_building`)
- `reportMode` resolves to `rent`

## Structural Facts Checklist

- [ ] `listingScope` resolves to `private_room` (not
      `single_property`, not `multi_unit_building`)
- [ ] `reportMode` resolves to `rent`
- [ ] No Sale-only fields
- [ ] No `floorPlanSummaries` / `availableUnits` (private rooms do
      not have a building structure)
- [ ] Gallery complete

## Dynamic Facts

- Current room rent
- Current availability
- Current utilities-included status