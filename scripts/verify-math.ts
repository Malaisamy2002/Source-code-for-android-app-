/**
 * Independent math audit — run with:  bun scripts/verify-math.ts
 *
 * Builds two months of tailored, hand-checkable data (July + August 2026),
 * computes every headline figure BY HAND (literal arithmetic below), then
 * compares those literals against what the app's shared calculators return
 * (periodStats/statsForMonth in lib/analytics.ts, customerLifetimeStats in
 * lib/data.ts, taxBreakdown in lib/settings.ts, tabBalanceOf in lib/tabs.ts).
 *
 * Any mismatch is a real bug in one of those two sides — the point is that
 * the same money must never be reachable by two different paths
 * (docs/calculation-rules.md).
 */
import type { AppSettings } from "../src/lib/settings";

// A localStorage/window stub so readAppSettings() and Dexie-free helpers work
// under bun before any app module is imported.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>)["window"] = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const {
  periodStats,
  statsForMonth,
  monthKey,
  dayKey,
  isFinancialBooking,
  paymentSplit,
  pctChange,
} = await import("../src/lib/analytics");
const { taxBreakdown, DEFAULT_APP_SETTINGS } = await import("../src/lib/settings");
const { customerLifetimeStats } = await import("../src/lib/data");
const { tabBalanceOf, tabKey } = await import("../src/lib/tabs");

/* ------------------------------------------------------------------ setup */

// GST 18% + a 5% service charge => 23% of every bill's pre-tax total.
const settings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  gstEnabled: true,
  gstRate: 18,
  customTaxes: [{ id: "svc", label: "Service Charge", rate: 5, enabled: true }],
};
const TAX = 0.23;
const JUL = "2026-07";
const AUG = "2026-08";

type AnyRec = Record<string, unknown>;

const bills = [
  // paid in full (amount_paid deliberately 0 — "paid" means gross collected)
  {
    id: "b1",
    invoice_no: "INV-1",
    customer_name: "Ravi",
    customer_phone: "9876543210",
    items: [],
    subtotal: 1000,
    discount: 0,
    total: 1000,
    amount_paid: 0,
    status: "paid",
    payment_mode: "Cash",
    bill_date: "2026-07-05T06:30:00.000Z",
  },
  // 31 Jul 20:00 UTC == 1 Aug 01:30 IST -> must land in AUGUST
  {
    id: "b2",
    invoice_no: "INV-2",
    customer_name: "Ravi",
    customer_phone: "9876543210",
    items: [],
    subtotal: 2000,
    discount: 0,
    total: 2000,
    amount_paid: 500,
    status: "partial",
    payment_mode: "UPI",
    bill_date: "2026-07-31T20:00:00.000Z",
  },
  {
    id: "b3",
    invoice_no: "INV-3",
    customer_name: "Priya",
    customer_phone: "9000000001",
    items: [],
    subtotal: 500,
    discount: 0,
    total: 500,
    amount_paid: 0,
    status: "unpaid",
    payment_mode: null,
    bill_date: "2026-07-10T05:00:00.000Z",
  },
  {
    id: "b4",
    invoice_no: "INV-4",
    customer_name: "Priya",
    customer_phone: "9000000001",
    items: [],
    subtotal: 1500,
    discount: 0,
    total: 1500,
    amount_paid: 0,
    status: "paid",
    payment_mode: "Cash",
    bill_date: "2026-08-12T05:00:00.000Z",
  },
] as unknown as Parameters<typeof periodStats>[0]["bills"];

const booking = (o: AnyRec) => ({
  status: "Confirmed",
  merged_into_bill_id: null,
  payment_mode: "Cash",
  snacks: [],
  snacks_total: 0,
  ...o,
});
const bookings = [
  booking({
    id: "k1",
    customer_name: "Ravi",
    phone: "9876543210",
    booking_date: "2026-07-04",
    total_amount: 1200,
    advance_paid: 400,
  }),
  booking({
    id: "k2",
    customer_name: "Priya",
    phone: "9000000001",
    booking_date: "2026-07-18",
    total_amount: 800,
    advance_paid: 800,
    status: "Completed",
  }),
  booking({
    id: "k3",
    customer_name: "Priya",
    phone: "9000000001",
    booking_date: "2026-07-20",
    total_amount: 600,
    advance_paid: 0,
    status: "Cancelled",
  }),
  booking({
    id: "k4",
    customer_name: "Ravi",
    phone: "9876543210",
    booking_date: "2026-07-25",
    total_amount: 900,
    advance_paid: 300,
    merged_into_bill_id: "b1",
  }),
  booking({
    id: "k5",
    customer_name: "Ravi",
    phone: "9876543210",
    booking_date: "2026-08-03",
    total_amount: 1000,
    advance_paid: 0,
  }),
  booking({
    id: "k6",
    customer_name: "Priya",
    phone: "9000000001",
    booking_date: "2026-08-22",
    total_amount: 1500,
    advance_paid: 1500,
    status: "Completed",
  }),
] as unknown as Parameters<typeof periodStats>[0]["bookings"];

const sales = [
  {
    id: "s1",
    customer_name: "Ravi",
    sale_date: "2026-07-06",
    total: 300,
    profit: 100,
    payment_mode: "Cash",
  },
  {
    id: "s2",
    customer_name: "Walk-in",
    sale_date: "2026-07-19",
    total: 200,
    profit: 80,
    payment_mode: "UPI",
  },
  {
    id: "s3",
    customer_name: "Priya",
    sale_date: "2026-08-09",
    total: 450,
    profit: 150,
    payment_mode: "Cash",
  },
] as unknown as Parameters<typeof periodStats>[0]["sales"];

const expenses = [
  { id: "e1", category: "ingredients", amount: 250, spent_at: "2026-07-07" },
  { id: "e2", category: "labour", amount: 150, spent_at: "2026-07-28" },
  { id: "e3", category: "transport", amount: 400, spent_at: "2026-08-14" },
] as unknown as Parameters<typeof periodStats>[0]["expenses"];

const src = { bills, bookings, sales, expenses };

/* --------------------------------------------------- hand-computed truth */

const grossOf = (net: number) => net + net * TAX;

const expectedJul = {
  billsRevenue: 1000 + 500,
  tax: (1000 + 500) * TAX,
  turfRevenue: 1200 + 800, // k3 cancelled, k4 merged -> both excluded
  snacksRevenue: 300 + 200,
  netRevenue: 1500 + 2000 + 500,
  revenue: 1500 + 2000 + 500 + 1500 * TAX,
  collected: grossOf(1000) /* b1 */ + 0 /* b3 */ + (400 + 800) /* advances */ + 500 /* snacks */,
  expenses: 400,
  profit: 4000 - 400,
  dues: grossOf(500) - 0 /* b3 */ + (1200 - 400) + (800 - 800),
  snackProfit: 180,
};

const expectedAug = {
  billsRevenue: 2000 + 1500,
  tax: (2000 + 1500) * TAX,
  turfRevenue: 1000 + 1500,
  snacksRevenue: 450,
  netRevenue: 3500 + 2500 + 450,
  revenue: 3500 + 2500 + 450 + 3500 * TAX,
  collected: 500 /* b2 partial */ + grossOf(1500) /* b4 */ + 1500 /* advance */ + 450,
  expenses: 400,
  profit: 6450 - 400,
  dues: grossOf(2000) - 500 /* b2 */ + (1000 - 0) + 0,
  snackProfit: 150,
};

/* ------------------------------------------------------------- harness */

let failures = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const fmt = (n: unknown) => (typeof n === "number" ? n.toFixed(2) : String(n));

function check(label: string, actual: unknown, expected: unknown) {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? near(actual, expected)
      : actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${label.padEnd(46)} got ${fmt(actual).padStart(12)}   expected ${fmt(expected).padStart(12)}`,
  );
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/* ------------------------------------------------------- 1. date buckets */

section("1. Date bucketing (IST vs UTC)");
check("bill b1 month", monthKey(bills[0]!.bill_date), JUL);
check("bill b2 month (31 Jul 20:00 UTC -> IST Aug)", monthKey(bills[1]!.bill_date), AUG);
check("bill b2 day", dayKey(bills[1]!.bill_date), "2026-08-01");
check("booking k5 month (plain date)", monthKey("2026-08-03"), AUG);
check("expense e3 day (plain date)", dayKey("2026-08-14"), "2026-08-14");

/* ------------------------------------------------------------ 2. taxes */

section("2. Tax breakdown (GST 18% + Service 5%)");
const tb = taxBreakdown(1500, settings);
check("taxAmount on 1500", tb.taxAmount, 1500 * TAX);
check("line count (CGST+SGST+Service)", tb.lines.length, 3);
check("CGST half", tb.lines[0]!.value, (1500 * 0.18) / 2);
check("SGST half", tb.lines[1]!.value, (1500 * 0.18) / 2);
check("Service charge line", tb.lines[2]!.value, 1500 * 0.05);
check("no tax when disabled", taxBreakdown(1500, DEFAULT_APP_SETTINGS).taxAmount, 0);

/* -------------------------------------------------- 3. merge predicate */

section("3. isFinancialBooking");
check("plain booking counts", isFinancialBooking(bookings[0]!), true);
check("cancelled excluded", isFinancialBooking(bookings[2]!), false);
check("merged excluded", isFinancialBooking(bookings[3]!), false);

/* ----------------------------------------------- 4/5. monthly aggregates */

for (const [key, exp] of [
  [JUL, expectedJul],
  [AUG, expectedAug],
] as const) {
  section(`${key === JUL ? "4" : "5"}. ${key} monthly stats vs hand arithmetic`);
  const s = statsForMonth(src, key, settings);
  for (const field of Object.keys(exp) as (keyof typeof exp)[]) {
    check(`${key} ${field}`, s[field], exp[field]);
  }
  // Internal identities that must hold for any dataset.
  check(`${key} revenue = netRevenue + tax`, s.revenue, s.netRevenue + s.tax);
  check(
    `${key} netRevenue = bills + turf + snacks`,
    s.netRevenue,
    s.billsRevenue + s.turfRevenue + s.snacksRevenue,
  );
  check(`${key} profit = netRevenue - expenses`, s.profit, s.netRevenue - s.expenses);
}

/* ------------------------------------------- 6. two-month reconciliation */

section("6. Two months summed == one combined period");
const both = periodStats(src, (iso) => [JUL, AUG].includes(monthKey(iso)), settings);
const jul = statsForMonth(src, JUL, settings);
const aug = statsForMonth(src, AUG, settings);
for (const field of Object.keys(expectedJul) as (keyof typeof expectedJul)[]) {
  check(`combined ${field} = Jul + Aug`, both[field], jul[field] + aug[field]);
}
check("combined revenue vs literal", both.revenue, expectedJul.revenue + expectedAug.revenue);
check(
  "no double counting: every rupee once",
  both.netRevenue,
  // bills(1000+2000+500+1500) + live bookings(1200+800+1000+1500) + snacks(300+200+450)
  5000 + 4500 + 950,
);

/* --------------------------------------------------- 7. payment split */

section("7. Payment split (money actually received)");
const splitJul = paymentSplit(src, (iso) => monthKey(iso) === JUL);
const splitOf = (name: string) => splitJul.find((x) => x.name === name)?.value ?? 0;
// b1 amount_paid is 0 by design (status paid), advances 400+800 cash, snacks 300 cash / 200 UPI
check("Jul Cash", splitOf("Cash"), 400 + 800 + 300);
check("Jul UPI", splitOf("UPI"), 200);
check("Jul split total <= collected", splitOf("Cash") + splitOf("UPI") <= jul.collected, true);

/* ----------------------------------------------- 8. percentage change */

section("8. pctChange");
check("100 -> 150", pctChange(150, 100), 50);
check("from zero base", pctChange(150, 0), null);
check("zero to zero", pctChange(0, 0), 0);
check(
  "Jul->Aug revenue",
  pctChange(aug.revenue, jul.revenue),
  ((aug.revenue - jul.revenue) / jul.revenue) * 100,
);

/* --------------------------------------------- 9. per-customer rollups */

section("9. customerLifetimeStats (Ravi)");
const [ravi, priya] = customerLifetimeStats(
  [
    { id: "c1", name: "Ravi", phone: "9876543210" },
    { id: "c2", name: "Priya", phone: "9000000001" },
  ],
  src as never,
);
check("Ravi billsSpend", ravi!.billsSpend, 1000 + 2000);
check("Ravi turfSpend (k4 merged excluded)", ravi!.turfSpend, 1200 + 1000);
check("Ravi snacksSpend", ravi!.snacksSpend, 300);
check("Ravi totalSpend", ravi!.totalSpend, 3000 + 2200 + 300);
check("Ravi bookingsCount (merged counted)", ravi!.bookingsCount, 3);
check("Ravi avgBookingValue", ravi!.avgBookingValue, (1200 + 900 + 1000) / 3);
check("Ravi outstandingTurfDues", ravi!.outstandingTurfDues, 1200 - 400 + (1000 - 0));
check("Ravi firstActivity", ravi!.firstActivity, "2026-07-04");
check("Priya turfSpend (cancelled excluded)", priya!.turfSpend, 800 + 1500);
check("Priya outstandingTurfDues", priya!.outstandingTurfDues, 0);
check(
  "customer spend sum = netRevenue - walk-in snacks",
  ravi!.totalSpend + priya!.totalSpend,
  both.netRevenue - 200,
);

/* ------------------------------------------------------- 10. tab ledger */

section("10. Customer tab ledger");
const entry = (kind: "charge" | "payment", amount: number) => ({ kind, amount }) as never;
check(
  "balance of charges - payments",
  tabBalanceOf([entry("charge", 200), entry("charge", 800), entry("payment", 500)]),
  500,
);
check("settled tab", tabBalanceOf([entry("charge", 250), entry("payment", 250)]), 0);
// Whole-rupee rule (lib/money.ts): a tab balance never carries paise, and each
// entry is rounded once before it is summed — 3 × ₹0.60 is ₹3, not ₹1.80.
check(
  "whole rupees, rounded once (0.6*3)",
  tabBalanceOf([entry("charge", 0.6), entry("charge", 0.6), entry("charge", 0.6)]),
  3,
);
check(
  "sub-rupee entries round to zero",
  tabBalanceOf([entry("charge", 0.1), entry("charge", 0.1), entry("charge", 0.1)]),
  0,
);
check("phone key wins", tabKey("Ravi Kumar", "+91 98765 43210"), "p:9876543210");
check("typo-proof phone key", tabKey("Ravii", "9876543210"), tabKey("Ravi", "9876543210"));
check("name fallback", tabKey("  Ravi Kumar ", ""), "n:ravi kumar");
check(
  "tab dues are separate from booking dues",
  // Ravi's turf dues (800 + 1000) must NOT change when a tab charge exists
  ravi!.outstandingTurfDues,
  1800,
);

/* ---------------------------------------------------------------- done */

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — Jul revenue ${jul.revenue.toFixed(2)}, Aug revenue ${aug.revenue.toFixed(2)}, combined ${both.revenue.toFixed(2)}\n`,
);
process.exit(failures === 0 ? 0 : 1);
