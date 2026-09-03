# Money & Date Math — Spec / Prompt for Dashboard & Reports

Use this as the prompt/checklist whenever you (or an AI assistant) add or
touch anything that computes revenue, dues, profit, or per-customer totals
in this app. The goal is zero double-counting and zero drift between the
Dashboard, the Reports tab, and any Excel/PDF export. Every number below
must trace back to one of the two shared functions — `periodStats` /
`statsForMonth` (src/lib/analytics.ts) or `customerLifetimeStats`
(src/lib/data.ts) — never re-derived by hand in a component.

---

## 0. THE rounding rule — whole rupees, rounded once

Every payable or displayed amount in this app is a **whole rupee**. There
are no paise anywhere: not on a bill, not on a receipt, not in an Excel
export, not on a dashboard card.

All of it goes through `src/lib/money.ts` — the single rule:

```ts
rupees(n)        // whole rupee, half away from zero (0.5 -> 1, -0.5 -> -1)
money(n)         // "₹1,23,456" — whole rupees, Indian grouping
splitHalf(total) // two halves that add back to `total` exactly (CGST/SGST)
sumRupees(list)  // Σ rupees(x) — each amount rounded once, then summed
```

Rules:

1. **Round once, at the point money becomes payable** — line total,
   discount, each tax line, the grand total. Never round the same rupee
   twice, and never round a subtotal and then round its parts again.
2. **Never write your own formatter.** No `toFixed(2)`,
   no `Math.round(x * 100) / 100`, no bare `toLocaleString("en-IN")` for
   money. Use `money()`; PDFs use their local `pmoney()`, which is
   `rupees()` plus a "Rs " prefix because helvetica has no ₹ glyph.
3. **Sum rounded parts, don't round the sum.** `taxBreakdown()` returns
   `taxAmount` as the sum of its own printed lines, so a receipt's
   CGST + SGST + custom taxes always equal its Grand Total on paper.
4. **Halves must add back.** GST is split with `splitHalf()`, so
   CGST + SGST is exactly the GST amount (half of ₹101 prints as ₹51 + ₹50,
   never ₹50.50 twice).
5. **Tab ledger entries are whole rupees too** (`buildTabEntry`,
   `tabBalanceOf`), so a running balance can never drift into paise.
6. **Excel money columns use `#,##0`** (no decimals) — an export must show
   the same figure as the screen it came from.

Where this is enforced: `money.ts` (rule), `biz.ts` (`rowTotal`,
`billGrossTotal`, `balanceOf`), `settings.ts` (`taxBreakdown`),
`dues.ts`, `tabs.ts`, `merge.ts`, `analytics.ts`, `receipt.ts`,
`report-pdf.ts`, `dashboard-xlsx.ts`, `xlsx.ts`.

---

## 0b. Discount before tax

Discounts are **always** applied before tax:

```
taxable = subtotal - discount        // this is what `bill.total` stores
tax     = Σ round(taxable × rate)    // one rounded line per active tax
gross   = taxable + tax              // what the customer pays
```

`bill.total` is therefore already post-discount everywhere it is written
(`TurfTab`: `gross - discount`; `MergeBillDialog`: `grossTotal - mergedDiscount`),
and every tax call site passes that stored total — never the subtotal.
Nothing may tax a pre-discount amount, and nothing may subtract a discount
after tax has been added.

---

## 1. The three business lines + expenses

| Line | Source table | Date field | Notes |
|---|---|---|---|
| Bills | `bills` | `bill_date` (full ISO timestamp) | Only line with tax |
| Turf bookings | `bookings` | `booking_date` (plain `YYYY-MM-DD`) | Excludes `Cancelled`; excludes merged (see §2) |
| Snack sales | `sales` | `sale_date` (plain `YYYY-MM-DD`) | |
| Expenses | `expenses` | `spent_at` | Never revenue — subtract only |

**Date parsing bug to avoid:** `bill_date` is a full UTC timestamp; the
other two are plain local dates. Slicing the first 7 chars of a UTC
timestamp to get a month key silently mis-buckets bills made in the last
~5.5 hours of the UTC day (IST). Always route dates through `monthKey()` /
`dayKey()` in analytics.ts — never re-slice or re-parse a date string
inline in a component or export.

---

## 2. THE double-counting rule: merged bookings

A turf booking can be merged into a Bill (`merged_into_bill_id` set). Once
merged, **its revenue lives on the Bill, not on the booking.** Any
calculation that sums both `bills` and `bookings` for the same period
MUST exclude merged bookings from the booking side, or that money is
counted twice.

**This is centralized. Use it, don't re-derive it.** `src/lib/analytics.ts`
exports:

```ts
export const isFinancialBooking = (b) =>
  b.status !== "Cancelled" && !b.merged_into_bill_id;
```

This is the one place in the whole app that decides whether a booking is
still its own financial record. Every money-summing call site — Dashboard,
Reports, exports, the Turf tab, the Snacks tab, MergeBillDialog's picker,
per-customer rollups — filters through `isFinancialBooking(b)` instead of
re-writing the two-clause check inline. Before this was centralized, the
same condition was independently copy-pasted in 15+ places across the
codebase; that's how a bug like "this one screen forgot the merge check"
sneaks in silently. If you add a new money calculation, import
`isFinancialBooking` from `@/lib/analytics` — don't write
`status !== "Cancelled" && !merged_into_bill_id` again by hand.

```ts
// Correct
const bookings = src.bookings.filter(
  (b) => matches(b.booking_date) && isFinancialBooking(b),
);
```

**Exception — counts that are about the booking as an event, not as
money** (e.g. "how many bookings did this customer make", "what's their
average booking value") legitimately include merged bookings, because the
booking still happened even though its cash is now tracked on a Bill.
Only *money* fields need the merge exclusion — see `bookingsCount` /
`avgBookingValue` in `customerLifetimeStats`, which deliberately do NOT
filter through `isFinancialBooking`.

Before adding any new sum that touches both `bills` and `bookings`, ask:
**"If I add these two totals together, could the same rupee show up in
both?"** If yes, filter merged bookings out via `isFinancialBooking`.

There are two narrow, intentional exceptions where `isFinancialBooking`
is NOT used even though the code touches `merged_into_bill_id`:
- `TurfUtilizationCard.tsx` — tracks court-hours occupied, not money; a
  merged booking still occupied the slot.
- The raw "Turf bookings" export sheets (Reports and Turf tab) — these
  intentionally list every booking, including merged and cancelled ones,
  for audit purposes, and zero the money columns per-row instead of
  dropping the row, so a reader can still see the full history.

---

## 3. Cancelled bookings

`status === "Cancelled"` bookings are excluded from every revenue, dues,
and payment-split calculation (they never became real income) but they
are **not** excluded from `customerLifetimeStats` today — check whether
that's intentional before extending it; a cancelled booking with no
payment contributes 0 either way, but if you add a "no-show rate" or
similar metric, filter cancellations explicitly rather than assuming
downstream functions already did.

---

## 4. Tax — bills only

Turf bookings and snack sales never carry tax. Only Bills go through
`taxBreakdown(net, appSettings)`:

```
net    = bill.total                          // pre-tax, as stored
gross  = net + taxAmount
paid   = status === "paid" ? gross : amount_paid
dues  += max(0, gross - paid)
```

- `revenue` (headline, gross) = `netRevenue + billsTax`
- `netRevenue` (no tax) = `billsRevenue + turfRevenue + snacksRevenue`
- **Profit is always based on `netRevenue`, never `revenue`.** Tax is
  money passed through to the government, not earnings — including it in
  profit would overstate the business's actual take whenever tax is
  turned on.

Never apply `taxBreakdown` to turf or snack totals — they're not taxable
in this app's model.

---

## 5. Definitions, formula-exact

All of the below come from `periodStats(src, matches, appSettings)` in
src/lib/analytics.ts. Don't recompute any of these inline — import and
call this function (via `statsForMonth`/`statsForDay`) instead.

```
billsRevenue   = Σ bill.total                                  (pre-tax)
billsTax       = Σ taxBreakdown(bill.total).taxAmount
billsCollected = Σ (status === "paid" ? gross : amount_paid)
billsDues      = Σ max(0, gross - paid)

turfRevenue    = Σ booking.total_amount        (unmerged, non-cancelled only)
snacksRevenue  = Σ sale.total

netRevenue     = billsRevenue + turfRevenue + snacksRevenue
revenue        = netRevenue + billsTax
tax            = billsTax

collected      = billsCollected
               + Σ booking.advance_paid        (unmerged, non-cancelled)
               + snacksRevenue                 (assumed fully paid at sale)

expenses       = Σ expense.amount
profit         = netRevenue - expenses          // NOT revenue - expenses

dues           = billsDues
               + Σ max(0, booking.total_amount - booking.advance_paid)  (unmerged, non-cancelled)
               // snack sales have no "dues" concept — always fully paid

snackProfit    = Σ sale.profit
```

`avgBookingValue` (Reports/Dashboard KPI, month-scoped) =
`turfRevenue / (count of unmerged, non-cancelled bookings that month)`.

---

## 6. Customer-level rollup (`customerLifetimeStats`, src/lib/data.ts)

Same anti-double-counting rules as §2–5, applied per customer instead of
per period. Customer identity match: phone match wins if both records
have a normalized phone; otherwise fall back to normalized name
(`normName`/`normPhone`/`customerKey` — reuse these, don't write a second
identity rule that can drift from the merge/dedupe logic elsewhere).

```
billsSpend           = Σ matched bill.total
turfSpend            = Σ matched booking.total_amount   (unmerged only — merged
                        booking's money is inside billsSpend already)
snacksSpend          = Σ matched sale.total
totalSpend           = billsSpend + turfSpend + snacksSpend

bookingsCount        = count of ALL matched bookings (merged included —
                        it's a count of visits, not money)
avgBookingValue      = Σ ALL matched booking.total_amount (merged included)
                        / bookingsCount
                        // Deliberately uses gross booking value, not turfSpend,
                        // so a merged booking doesn't silently read as ₹0 and
                        // drag the average down.

outstandingTurfDues  = Σ max(0, total_amount - advance_paid) over UNMERGED
                        matched bookings only (a merged booking is settled
                        through its bill, so it can't still be "due" here)

firstActivity/lastActivity = min/max ISO date across all matched
                        bills/bookings/sales (no exclusions — even a
                        cancelled booking or merged one is still a real
                        touchpoint with the business)
```

**Why `avgBookingValue` and `turfSpend` use different booking sets on
purpose:** `turfSpend` is a *cash total* (must not double-count), so it
excludes merged bookings. `avgBookingValue` is a *per-event average*
(nothing to double-count), so it uses every booking. Applying the
turfSpend-style exclusion to avgBookingValue would understate the average
for any customer who has merged bookings.

---

---

## 7. Watch item: dormant fields that could become a new double-count

`TurfBooking.snacks` / `TurfBooking.snacks_total` exist in the type but
are currently dead — every write site sets them to `[]`/`0` and nothing
reads them for money. Snacks linked to a booking today go through the
separate `sales` table instead (`SnacksTab`'s `booking_id` link), counted
once via `snacksRevenue`.

If a future feature starts writing real values into `booking.snacks`
instead (e.g. "add snacks directly to a booking" without a separate sale
record), that money **must** be excluded from `snacksRevenue` wherever
it's summed — otherwise the same snack sale would be counted once via
`sales` and again via the booking. Follow the same pattern as
`isFinancialBooking`: one shared predicate/field, reused everywhere,
never an inline check re-derived per call site.

---

## 8. Checklist before shipping a new calculation

Run through this explicitly, in comments or in your PR description if the
logic is non-trivial:

1. **Does this sum bills and bookings together?** → filter the booking
   side through `isFinancialBooking` (imported from `@/lib/analytics`) —
   never re-write the two-clause check by hand.
2. **Does this sum bookings at all?** → `isFinancialBooking` already
   excludes `Cancelled`; if you deliberately need cancelled rows for a
   specific metric (e.g. a cancellation-rate report), filter that in
   explicitly and say why in a comment.
3. **Is this a money total or an event count?** → money totals exclude
   merged bookings; event counts (bookings count, visit count, avg value)
   include them.
4. **Does this touch tax?** → only Bills carry tax; profit uses
   `netRevenue`, never `revenue`.
5. **Does this parse a date string directly?** → don't; route through
   `monthKey`/`dayKey` to avoid the UTC-slice bug on `bill_date`.
6. **Is there already a shared function for this?** (`periodStats`,
   `customerLifetimeStats`, `paymentSplit`, `expenseByCategory`,
   `profitAndLoss`, `taxReport`) → extend it in place rather than writing
   a parallel calculation in a component or export — two implementations
   of "this period's revenue" is how Dashboard and Reports drift apart.
7. **If you add a field to a shared stats function, update every caller**
   (search the whole repo for the function name) so a widened type
   doesn't leave one export silently reporting stale/zero values for the
   new column.
8. **Sanity-check with a known bad case**: a customer/period with (a) a
   merged booking, (b) a cancelled booking, (c) a partially-paid bill.
   Confirm the total doesn't include the cancelled booking, doesn't
   double-count the merged one, and dues reflect only what's actually
   outstanding.
