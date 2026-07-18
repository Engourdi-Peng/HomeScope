# Pricing Source of Truth (manual sync)

This file is the human-maintained pricing reference. When a price changes, every
entry below and every code reference must be updated together. The CI does not
enforce consistency — please run the checklist before pushing.

## Pricing table

| Plan     | Display price | Reports | Paddle price_id (sandbox) | Paddle price_id (live) |
|----------|---------------|---------|---------------------------|------------------------|
| starter  | $6.99         | 5       | `<fill in sandbox pri_>`  | `<fill in live pri_>`  |
| standard | $15.99        | 12      | `<fill in sandbox pri_>`  | `<fill in live pri_>`  |
| pro      | $39.99        | 35      | `<fill in sandbox pri_>`  | `<fill in live pri_>`  |

The Paddle price_id is what the user is actually charged. The four code locations
below only mirror the same numbers for display / DB record / commission calc.
If they disagree, customers either see the wrong number, get credited the wrong
number of reports, or pay an affiliate the wrong commission.

## Code references (must match the table above)

| Location                                                       | What it sets                                |
|----------------------------------------------------------------|---------------------------------------------|
| `src/pages/Pricing.tsx` L14-58 (PRODUCTS)                      | Display price + reportCount for the cards   |
| `supabase/functions/create-order/index.ts` L14-24              | `BASE_CREDITS` + `PLAN_PRICES`              |
| `supabase/functions/paddle-webhook/index.ts` L14-30            | `BASE_CREDITS` + `PLAN_PRICES` + `AFFILIATE_BONUS` |
| `supabase/migrations/017_fix_pro_plan_commission_price.sql` L78-83 | CASE in `process_paddle_completed_transaction` for commission `purchase_amount` |

## Env vars (must match the price_ids)

| Env var                       | Value              |
|-------------------------------|--------------------|
| `PRICE_STARTER_SANDBOX`       | `<pri_...>`        |
| `PRICE_STARTER_LIVE`          | `<pri_...>`        |
| `PRICE_STANDARD_SANDBOX`      | `<pri_...>`        |
| `PRICE_STANDARD_LIVE`         | `<pri_...>`        |
| `PRICE_PRO_SANDBOX`           | `<pri_...>`        |
| `PRICE_PRO_LIVE`              | `<pri_...>`        |

Set via `supabase secrets set PRICE_<PLAN>_<ENV>=pri_...` for each environment.

## Affiliate bonus (proportional, by plan)

| Plan     | Affiliate bonus (extra credits) |
|----------|---------------------------------|
| starter  | 0                               |
| standard | 1                               |
| pro      | 2                               |

Defined in `supabase/functions/paddle-webhook/index.ts` as `AFFILIATE_BONUS`.

## Sync checklist

Run these steps when price, report count, or bonus changes:

1. Update Paddle Dashboard (price + price_id for the affected env)
2. Set `PRICE_<PLAN>_<ENV>` via `supabase secrets set`
3. Edit `src/pages/Pricing.tsx` (PRODUCTS array)
4. Edit `supabase/functions/create-order/index.ts` (BASE_CREDITS / PLAN_PRICES)
5. Edit `supabase/functions/paddle-webhook/index.ts` (BASE_CREDITS / PLAN_PRICES / AFFILIATE_BONUS)
6. Edit `supabase/migrations/017_fix_pro_plan_commission_price.sql` (CASE expression)
7. Run the new migration against sandbox and prod
8. Re-deploy `supabase functions deploy create-order paddle-webhook`
9. Manually verify a sandbox purchase round-trip:
   - `/pricing` shows the new display price
   - Checkout completes
   - `payments.status` ends as `paid` (not stuck on `pending`)
   - `profiles.credits_remaining` increases by the new `BASE_CREDITS`
   - If affiliate code used: `affiliate_commissions.purchase_amount` matches the new price

## Why no shared TS file

We deliberately do not share `BASE_CREDITS`/`PLAN_PRICES` between the Vite
front-end and the Deno edge runtime. Sharing would require either (a) shipping
shared TS through the Deno build, or (b) duplicating types. Both options
introduce more complexity than the four-way mirror costs in practice. If
this becomes a recurring source of bugs, revisit then.