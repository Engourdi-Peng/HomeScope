# Zillow Golden Regression Cases

> Phase 1A of the HomeScope Zillow migration plan. Real-page, human-driven
> regression baseline. This directory is the **only** regression safety net
> for `extension/content.js` changes until Phase 1B (Automated Fixtures)
> ships.

## Why this exists

Before changing `extension/content.js`, you need a way to verify that:

1. **Sale / Rent / Building / Private Room** paths still produce the
   correct structural facts.
2. **Pricing / unit / promotion / calculator / gallery** modules still
   pick the right evidence.
3. New fixes do not silently regress previously-working pages.

These cases are the answer. They are NOT a unit test suite — they are
**manual regression checkpoints** that must be walked after each Zillow
extractor change.

## How a case is structured

Every case file MUST contain three blocks:

1. **`Page Facts`** — what Zillow actually shows on the page. This is the
   ground truth. It is allowed (expected) to drift over time.
2. **`Current HomeScope Status`** — what the current extractor outputs.
   This is allowed to lag behind `Page Facts` when there is a known bug.
3. **`Structural Facts Checklist`** — the list of structural invariants
   that must NEVER change without code changes. If one of these changes
   on a regression walk, that is a real bug, not data drift.

Cases MUST NOT collapse these three into a single "expected" block —
otherwise a bug fix later will be misreported as a regression.

See [`01-multi-unit-building-winbro.md`](./01-multi-unit-building-winbro.md)
for the canonical worked example.

## Static vs dynamic facts

| Class | Examples | How to verify |
|-------|----------|---------------|
| Structural | listingScope identification, floorPlanSummaries vs availableUnits split, field cross-contamination, gallery completeness, "Nearby Apartments" not leaking into the listing | If it changes → code bug |
| Dynamic | Current price, unit count, promotion text, availability, days on market | Re-read from the live page on each regression walk |

> **Never** hard-compare against a frozen number (e.g. "$775") — Zillow's
> data drifts. Always re-read the live page and update `Page Facts`.

## Regression walk procedure

```
1. After modifying extension/content.js
2. Reload the Chrome extension
3. For each case in this directory:
   a. Open the page in Chrome
   b. Open DevTools and invoke the extractor entry point
   c. Compare Current HomeScope Output against Page Facts
   d. Walk the Structural Facts Checklist
4. If a structural fact changed → regression, investigate
5. If a dynamic fact changed → re-read Page Facts, update the case file
6. If a "Current HomeScope Status" bug was fixed → update that section
   (this is NOT a regression)
```

## Cases

| # | Case | Page type | Status |
|---|------|-----------|--------|
| 1 | [01-multi-unit-building-winbro](./01-multi-unit-building-winbro.md) | Multi-unit Building | ✅ Captured (template + facts from code analysis) |
| 2 | [02-building-with-selected-unit](./02-building-with-selected-unit.md) | Building + Selected Unit | 📝 Template — needs page walk |
| 3 | [03-sale-single-family-house](./03-sale-single-family-house.md) | Sale Single-Family House | 📝 Template — needs page walk |
| 4 | [04-sale-condo-townhouse](./04-sale-condo-townhouse.md) | Sale Condo/Townhouse | 📝 Template — needs page walk |
| 5 | [05-rent-single-family-house](./05-rent-single-family-house.md) | Rent Single-Family House | 📝 Template — needs page walk |
| 6 | [06-rent-apartment](./06-rent-apartment.md) | Rent Apartment | 📝 Template — needs page walk |
| 7 | [07-private-room](./07-private-room.md) | Private Room | 📝 Template — needs page walk |
| 8 | [08-multifamily-sale](./08-multifamily-sale.md) | Multifamily Sale | 📝 Template — needs page walk |

## When to expand

- Add a new case whenever a new Zillow page shape is observed (e.g.
  senior living, new construction, etc.) — not sooner.
- Remove a case only if the page type no longer exists on Zillow.
- For each bug fix in `content.js`, update the matching `Current
  HomeScope Status` section, do **not** rewrite `Page Facts`.

## See also

- Migration plan: `c:\Users\47201\.cursor\plans\homescope_zillow_migration_-_revised_3bed82bc.plan.md`
- Source of truth: `extension/content.js` (frozen reference: `src/content/extractors/zillow.ts`)