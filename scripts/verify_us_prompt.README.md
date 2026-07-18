# US Sale Prompt — Acceptance

`scripts/verify_us_prompt.ts` is a mechanical grader for the US Sale prompt
overhaul contract. It scores four criteria against a real LLM JSON output
(or a fixture) on a 0–100 scale and prints a per-criterion breakdown so we
can tell whether a report actually meets the four stated requirements.

## Rules graded

| Rule | What it checks | Pass threshold |
|---|---|---|
| **R1 — risk_categories** | All four keys present (`foundation_basement`, `water_leaks`, `roof_exterior`, `hidden_ownership_cost`); every non-null entry has `risk_level` ∈ {High, Medium, Low, Unknown} AND `why_it_matters` (≥10 chars) AND `signal` (≥1 char) | 20/25 |
| **R2 — listing_does_not_prove** | ≥5 items, each ≥5 chars, ≥3 hit buyer-critical keywords (roof / foundation / basement / plumbing / electrical / panel / hvac / water heater / hoa / permit / comps / disclosure / inspection / oil tank / easement), dedup ratio ≥60% | 18/25 |
| **R3 — before_you_book_showing** | 5–10 items, every item ends with "?", ≥50% reference a risk-category or listing-does-not-prove item | 18/25 |
| **R4 — photo_review risk** | ≥70% of `areas[].visibleConcerns` use risk markers (may / could / not prove / verify / permit / unknown / risk / concern …); no banned aesthetic phrases ("makes the space feel", "patchy grass", "limited natural light", "older cabinets", "small room", "busy backsplash", "looks dated but clean", "cozy feel"); no overrule patterns ("appears to be a semi-detached / multi-family / illegal basement apartment") unless the listing type field actually says so | 18/25 |

A report passes the overall gate at **≥75/100** and at least **3/4** criteria
passing.

## Usage

```bash
# Run against every fixture under scripts/fixtures/us_sale/*.json
npm run verify:us-prompt

# Grade a single real result captured from the analyze pipeline
npx tsx scripts/verify_us_prompt.ts path/to/result.json
```

Exit codes:
- `0` — overall ≥75% (pass)
- `2` — overall <75% (fail) or no inputs

## Fixtures

The grader ships three canonical fixtures so the script self-tests:

| Fixture | Score | Purpose |
|---|---|---|
| `fixtures/us_sale/passing-baseline.json` | 100/100 | Reference shape — what a fully compliant report looks like |
| `fixtures/us_sale/failing-baseline.json` | ~10/100 | Empty risk_categories + boilerplate marketing language |
| `fixtures/us_sale/property-type-overrule.json` | ~5/100 | Both banned aesthetic phrases AND property-type reclassifications ("appears to be a semi-detached", "illegal basement apartment") |

Whenever you tweak the prompt, drop a fresh LLM output into fixtures and re-run.
If the new sample drops below 75, the diff is in the failing criteria's
`reason` field — read that first.

## Capture script (optional)

A typical pipeline capture looks like:

```bash
# Inside a dev environment, after one analyze call:
curl -s "$LOCAL_URL/rest/v1/analyses?id=eq.<analysisId>&select=result" \
  -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" \
  | jq -r '.[0].result' > scripts/fixtures/us_sale/<listing>_<date>.json
npm run verify:us-prompt
```

## What the grader does NOT check

- Factual correctness of the LLM's claims — that still requires human review.
- Tone / voice / number-of-sentences — qualitative judgement.
- Other markets (AU sale, US rent, AU rent) — AU Sale prompt has its own structure
  and was not part of this contract.
- The visual quality or styling of the report UI.

## Maintenance

When the contract schema evolves:

1. Update `ReportResult` and the four `gradeR*` functions in `verify_us_prompt.ts`.
2. Refresh the canonical fixtures (especially `passing-baseline.json`).
3. Re-run until exit code 0 against the passing fixture before merging.
