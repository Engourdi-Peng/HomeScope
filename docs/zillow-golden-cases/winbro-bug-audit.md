# Winbro Bug Fix Audit Report

> Produced as part of Phase 0 / pre-Phase-2 audit. This document scopes
> the three known Winbro bugs and identifies the **minimum-change**
> fix points inside `extension/content.js` and `supabase/functions/analyze/`
> — without touching the migration plan itself.
>
> Read this alongside `docs/zillow-golden-cases/01-multi-unit-building-winbro.md`
> (the canonical Page Facts for Winbro).

## Bug inventory

| # | Symptom | Page Facts (expected) | Current HomeScope output | Severity |
|---|---------|-----------------------|--------------------------|----------|
| 1 | `rentalCostCalculator = null` | Page has "Cost Calculator" block with $769.16-$895, application $50, holding $165, deposit $700, etc. | Returns `null` | High — UI loses a whole section |
| 2 | `specialOfferText` leaks into unrelated fields | Page has clean "Special offer" block (4 Weeks Free, Apply within 24 hours, Move in by 8/15, $25 Uber Eats Gift Card) | Special offer text pollutes description / cost summary | High — credibility |
| 3 | `cost_and_fee_range.rentRange = "$855"` | Should be `$765 – $885` (the calculator's monthly base rent) or `$769.16 – $895` (est. total monthly cost). | AI outputs a single concrete unit's rent | High — price is materially wrong |

Each is treated as a **Bug Fix Track** item, decoupled from the
Architecture Track. Fixes must be **minimum-change** in `content.js`
(the production source of truth) per Phase 0, and must not regress
Golden Cases 2–8.

---

## Bug 1 — `rentalCostCalculator` returns `null`

### Where it lives

`extension/content.js`, function `extractZillowRentalCostCalculator()`
(defined ~line 8320; called from three sites ~8181 / 8533 / 8586).

### Root cause candidates (in order of likelihood)

1. **Heading filter rejects the heading on length** (line 8330):
   ```javascript
   if (txt.length > 80) return false;
   ```
   Zillow renders "Cost calculator" inside a `div`/`span` whose
   `textContent` includes the entire calculator body, easily exceeding
   80 chars. The heading element never matches, so the whole
   extraction returns `null`.

2. **Heading selector misses the element entirely**. Zillow uses
   `<h1>…<h6> | div | span | p`; if the heading is rendered as
   `<button>` or a custom element with `[role=heading]`, it falls
   through and nothing matches.

3. **Number parsers rely on labels that Zillow has tweaked**. The
   regex set (`'Est\\.?\\s*total monthly cost'`, `'Monthly base rent'`,
   `'Application Cost'`, etc.) was written for an older Zillow DOM
   and may miss current wording (e.g. "Estimated total monthly cost"
   vs "Est. total monthly cost").

### Fix points (smallest viable patch)

- **Bump the length filter**: change `txt.length > 80` to `> 240` —
  accommodates the calculator body but still rejects whole-page
  matches. Or move the length check onto `heading` *after* matching
  the short label regex, by climbing until the trimmed text is short.
- **Add heading selectors**: prepend `'button'`, `[role="heading"]`,
  `[data-testid*="cost" i]`, `[class*="Calculator" i]` to the
  `querySelectorAll` list.
- **Loosen label regexes** to allow optional words between label
  parts (e.g. `Est(?:imated)?\.?\s*total\s+monthly\s+cost`).
- **Tolerate labelled number formats** like `769.16` and `1,200`.

### Verification

- Re-run the regression walk for Case #1 (Winbro).
- Manually verify Cases #2 / #6 (other buildings) still produce
  `null` when the page has no calculator.

---

## Bug 2 — `specialOfferText` pollutes other modules

### Where it lives

`extension/content.js`, function `extractZillowBuildingSpecialOffer()`
(defined ~line 8236). Output flows to:
- `specialOfferText` and `specialOffers` (correct destinations)
- ...but the **text body** is also included in the broader `description`
  / `unit_specific_unknowns` blocks seen downstream.

### Root cause candidates

1. **Heading rank-by-distance picks the wrong heading**. When Zillow
   shows the same "Special offer" wording in two unrelated modules
   (e.g. once near the header, once in a sidebar / Nearby block),
   `ranked[0]` may pick the wrong one.

2. **`container = heading.closest('section')` is too broad**. The
   closest `<section>` may contain price / facts / description as
   siblings, all of which end up in `container.textContent`.

3. **Trailing-content trim is too weak**. The split at
   `/(Similar apartments|Nearby apartments|Other apartments you
   might)/i)[0]` only catches English siblings; a localized page or
   a rephrased section header won't get trimmed, and the full
   container text bleeds through.

4. **List bullets leak non-offer text**. Items join from `<li>`
   descendants of the section. If the section nests a description
   list inside the offer list, every list item gets included.

### Fix points

- **Tighten container scope**. Replace `closest('section')` with a
  walk that picks the nearest container whose direct children are
  either an offer list or offer paragraphs (e.g. match
  `[data-testid*="offer" i]`, `[class*="special-offer" i]`,
  `[class*="Special" i]`).
- **Filter items by content shape**. Only keep `<li>` whose text
  starts with an offer-shaped prefix ("Apply", "Move", "Free",
  "Get", "$", "Tour", or matches a verb pattern), rejecting items
  >240 chars or items containing "BEDS", "BATH", sqft markers, etc.
- **Hard-length guard**. Drop the result entirely if its text length
  exceeds, say, 600 chars — the genuine Winbro offer block is well
  under that.
- **Anchor to headerRoot more strictly**. Only consider candidates
  whose `distanceTo(candidate, headerRoot) <= 8` AND that fall inside
  a section containing the `building-name` element. Reject everything
  else even if it has the right text.

### Verification

- After the patch, Case #1's `specialOfferText` should be exactly the
  page's offer block (verbatim).
- Case #2 (selected unit) should still find the same offer.
- Cases #3, #4, #5, #8 (Sale-side) should NOT populate
  `specialOfferText`.

---

## Bug 3 — `cost_and_fee_range.rentRange = "$855"` (single unit rent leak)

### Where it lives

The AI decision object, mapped through:
- `supabase/functions/analyze/index.ts` ~line 9260 →
  `(result as any).buildingDetails.cost_and_fee_range =
     decisionAny?.cost_and_fee_range ?? null`
- `src/lib/reportAdapters/buildingDetails.ts` ~line 238 →
  `normalizeCostAndFeeRange(raw)`
- UI display in `BuildingRentReport.tsx`.

### Root cause candidates

1. **AI ignored the Discipline #8 rule** and pulled the rent from
   `IDENTIFIED UNITS: Unit 504: $855/mo`. The prompt injects both
   floor plans (range) and identified units (point estimates) into
   the same prompt — the model confuses sources.

2. **Prompt injects contradictory "facts"**. The floor plan summary
   line is `Studio: -/-/- sqft — $775–$895/mo — base rent $765–$885/mo
   · 3 units available`, and the identified unit line is `Unit 504:
   -/-/- sqft — $855/mo — available: TBD`. The model is told to
   "not replace the range with a single unit's price", but with two
   competing prices in the same prompt the rule is sometimes
   overridden.

3. **Calculator data is missing**. Bug 1's `rentalCostCalculator =
   null` means the prompt section "RENTAL COST CALCULATOR" never
   appears, so the model has only the floor-plan and unit rows to
   choose from, increasing the chance it picks the unit row.

### Fix points

The cleanest path is **to fix Bug 1 first** — once the calculator
block is present, the prompt's "Est. total monthly cost" line gives
the model an authoritative range that should anchor `totalMonthlyRange`
and `rentRange`. After Bug 1 is fixed, re-test Bug 3.

If Bug 3 still reproduces after Bug 1 is fixed:

- **Strip non-canonical pricing from the prompt injection** for the
  identified-units block when `listingScope === 'multi_unit_building'
  && !specificUnitSelected`. Keep unit numbers and availability but
  drop `monthlyRent` (since the unit's rent is *not* the advertised
  range).
- **Tighten Discipline #8** in `supabase/functions/analyze/prompts/
  us-prompts.ts`. Make it explicit that `rentRange` MUST come from
  either `cost_and_fee_range.totalMonthlyRange` or the floor-plan
  roll-up, and never from a single identified unit.
- **Post-process the AI output** in `analyze/index.ts` ~line 9260:
  if `cost_and_fee_range.rentRange` matches a single concrete unit's
  `monthlyRent` (with no range character), replace it with the
  floor plan's `minPrice–maxPrice` from the injected input.

### Verification

- Case #1: `cost_and_fee_range.rentRange` should be either
  `"$765 – $885"` (base rent) or `"$769.16 – $895"` (est. total
  monthly cost). The single point `$855` must not appear.
- Case #2 (selected unit): `rentRange` may now legitimately be the
  pinned unit's rent (since the page IS that unit).
- Cases #6 / #7 (other rent buildings): still range-only.

---

## Recommended execution order

1. **Fix Bug 1 first** — it is a precondition for proper rendering
   of the cost section AND it likely also reduces the chance of
   Bug 3 reproducing.
2. **Fix Bug 2 second** — independent of Bug 1, but visually
   important.
3. **Re-test Bug 3** — only patch if it still reproduces after
   Bug 1 is in. The Bug 3 patch is the most invasive (touches
   `analyze/index.ts` and possibly the prompt) so we want it
   last.

All fixes must be inside `extension/content.js` (Bug 1, Bug 2) or
`supabase/functions/analyze/` (Bug 3 fallback). None of them should
touch `src/content/extractors/zillow.ts` — that file is FROZEN per
Phase 0.

## See also

- Golden Case: `docs/zillow-golden-cases/01-multi-unit-building-winbro.md`
- Plan: `c:\Users\47201\.cursor\plans\homescope_zillow_migration_-_revised_3bed82bc.plan.md`
- Phase 0 (frozen reference): `src/content/extractors/zillow.ts` top
  comment
- Production source of truth: `extension/content.js` top comment