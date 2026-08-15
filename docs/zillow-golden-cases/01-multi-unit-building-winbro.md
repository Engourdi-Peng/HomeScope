# Case #1: Multi-unit Building (Winbro 1620 N Grant St, Denver)

> Canonical worked example for the Golden Cases format. This is the file
> the rest of the directory imitates.

## 页面身份

- **URL**: https://www.zillow.com/apartments/denver-co/winbro/ngrxxw/
  (or the current canonical Winbro URL — confirm on first walk)
- **页面类型**: multi-unit-building
- **listingScope**: `multi_unit_building`
- **reportMode**: `rent`
- **Verified Date**: _to be filled on first human walk_
- **Last Verified By**: _to be filled on first human walk_

> Data provenance: the `Page Facts` block below was assembled from the
> migration-plan discussion (see the latest plan revision). It MUST be
> re-validated against the live page before this case is promoted to
> "Verified".

---

## Page Facts (页面展示的真实内容, ground truth)

### Pricing

- `floorPlanSummaries`:
  - Studio: `unitCount` = ?, `priceRange` = `$775 – $895`
- `availableUnits` (specific concrete units, e.g. "Unit 504"):
  - Unit 504: `$855`

### specialOffer (页面明确展示)

- `4 Weeks Free`
- `Apply within 24 hours of tour`
- `Move in by 8/15`
- `$25 Uber Eats Gift Card after in-person tour`

### rentalCostCalculator (页面明确展示)

- `estimatedMonthly`: `$769.16 – $895`
- `baseRent`: `$765 – $885`
- `applicationFee`: `$50`
- `holdingCost`: `$165`
- `totalApplicationCost`: `$215`
- `deposit`: `$700`
- `moveInCost`: `$700`
- `electric / gas / trash / other reimbursement`: `Varies`

### Photos

- Gallery 完整, ≥ 12 张.

---

## Current HomeScope Status (当前 extractor 输出, 可能 ≠ Page Facts)

### Known bugs in current extractor

- `specialOfferText` extraction is **polluted** and leaks into other
  modules (e.g. description, cost summary). Listed as a Winbro bug.
- `rentalCostCalculator` currently resolves to **`null`** even though
  the page shows one.
- `Cost & Fee Range` shows `$855` — this is the *specific unit* price
  (Unit 504) leaked into the *advertised* range, conflating two
  different semantic sources.

### Known correct outputs

- `totalAvailableUnitCount` correctly derived from
  `floorPlanSummaries.unitCount` aggregation.
- `identifiedUnitCount` correctly derived from `availableUnits.length`.
- `totalAvailableUnitCount` ≠ `identifiedUnitCount` semantics preserved
  (no fallback to each other).
- `listingScope` correctly identified as `multi_unit_building`.
- Nearby Apartments module does not leak into the current listing's
  data set.

---

## Structural Facts Checklist (结构性事实, 必须稳定)

Re-run on every regression walk. ANY change here is a code bug.

- [ ] `listingScope` resolves to `multi_unit_building`
- [ ] `floorPlanSummaries` and `availableUnits` are semantically split
      (not conflated into one count)
- [ ] `totalAvailableUnitCount` and `identifiedUnitCount` do not
      fallback to each other
- [ ] No `Sale`-only fields appear in the output (this is a Rent page)
- [ ] "Nearby Apartments" module does not contribute to the current
      listing's facts
- [ ] Gallery is complete — no missing hero / thumbnail / floor-plan
      images

---

## Dynamic Facts (动态事实, 每次回归需与当天页面核对)

These are **expected to drift** over time. Re-read the live page on
each walk.

- Current `floorPlanSummaries` min/max price
- Current `availableUnits` list (unit numbers + monthly rent)
- Current `specialOffer` block (text + validity windows)
- Current `rentalCostCalculator` numbers (deposit, fees, base rent)
- Current `totalAvailableUnitCount` (live count, may differ from
  capture day)