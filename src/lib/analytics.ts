import { rupees } from "./money";
import type { Bill } from "@/lib/biz";
import type { ExpenseV2, SnackSale, TurfBooking } from "@/lib/ops";
import { readAppSettings, taxBreakdown, type AppSettings } from "@/lib/settings";
import { TAB_PAYMENT_MODE } from "@/lib/ops";
import type { TabEntry } from "@/lib/tabs";
import { TAB_REF_BILL } from "@/lib/tabs";
import {
  bookingDue,
  isFinancialBooking,
  isFinancialSale,
  netTabAmountFor,
  snackSaleCollected,
} from "@/lib/dues";

// Plain "YYYY-MM-DD" strings (booking_date, sale_date, spent_at) are sliced
// instead of parsed: Date construction per row is the single biggest cost
// once a year holds tens of thousands of records. bill_date, however, is
// stored as a FULL UTC timestamp (new Date().toISOString()) — that also
// starts with 10 digits matching this shape, but slicing it reads off the
// UTC calendar date, not the IST one. Only take the slice fast-path for
// strings that are exactly a plain date with no time component; anything
// longer is bucketed by explicit IST (UTC+5:30) arithmetic below.
//
// IMPORTANT: this used to read the bill_date's calendar day/month via
// `x.getFullYear()`/`getMonth()`/`getDate()` — but those are the JS
// runtime's LOCAL timezone, not IST specifically. That's the same class of
// bug this file exists to prevent: it silently gave the right answer only
// because the app happens to run on devices already set to IST, and
// silently gave the WRONG answer the moment it ran anywhere else (a CI
// runner, a differently-configured device, a browser with its clock set
// wrong) — a bill made in the last ~5.5 hours of the UTC day would land in
// the wrong month/day exactly like the bug this comment used to warn
// against, just one layer further out. IST has no daylight-saving shifts,
// so a fixed +5:30 offset applied to the UTC instant — then read back with
// UTC getters — gives the correct IST calendar date regardless of what
// timezone the code happens to be executing in.
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST (UTC+5:30) calendar instant for a given absolute time — read its
 * UTC getters afterwards for a runtime-timezone-independent IST date. */
const toIst = (x: Date) => new Date(x.getTime() + IST_OFFSET_MS);

export const monthKey = (d: string | Date) => {
  if (typeof d === "string" && PLAIN_DATE.test(d)) return d.slice(0, 7);
  const x = toIst(typeof d === "string" ? new Date(d) : d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });

export const dayKey = (d: string | Date) => {
  if (typeof d === "string" && PLAIN_DATE.test(d)) return d;
  const x = toIst(typeof d === "string" ? new Date(d) : d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(
    x.getUTCDate(),
  ).padStart(2, "0")}`;
};

// prevMonthKey/lastMonthKeys only ever do arithmetic on a "YYYY-MM" key
// they were themselves given (never a raw timestamp), so — like the plain
// booking_date/sale_date fast-path above — there's no instant-in-time to
// misinterpret. Still, the previous version routed through
// `new Date(y, m, 1)` (local-component constructor) before re-parsing with
// monthKey(), which made the result depend on the runtime's local
// timezone for no reason. Date.UTC() sidesteps that: pure calendar
// arithmetic on the key's own numbers, independent of wherever this runs.
export const prevMonthKey = (key: string) => {
  const [y = 0, m = 1] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // m is 1-indexed; -2 = previous month, 0-indexed
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const lastMonthKeys = (key: string, count: number) => {
  const [y = 0, m = 1] = key.split("-").map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
};

const num = (v: unknown) => Number(v) || 0;

// `isFinancialBooking` now lives in lib/dues.ts alongside the rest of the
// money rules (it is re-exported below so existing imports from
// "@/lib/analytics" keep working, and the dependency stays one-directional).
export { isFinancialBooking } from "./dues";

export type Sources = {
  bills: Bill[];
  bookings: TurfBooking[];
  sales: SnackSale[];
  expenses: ExpenseV2[];
  /**
   * The tab ledger. Optional so old call sites still compile, but WITHOUT it
   * an amount the operator moved onto a customer's running tab is counted
   * both here and in the Dues tab. Pass it wherever dues are shown.
   */
  tabEntries?: TabEntry[];
};

export type PeriodStats = {
  billsRevenue: number;
  turfRevenue: number;
  snacksRevenue: number;
  /** Total tax added on top of bills this period — shown as its own
   * dashboard figure rather than folded silently into revenue. */
  tax: number;
  /** Gross revenue including tax — the headline figure now that tax is
   * added on top of bills rather than hidden inside a net total. */
  revenue: number;
  /** Revenue before tax — bills + turf + snacks with no tax added. Use this
   * (alongside `tax`) wherever tax should be broken out instead of folded
   * into a single combined figure. */
  netRevenue: number;
  collected: number;
  expenses: number;
  profit: number;
  dues: number;
  snackProfit: number;
};

/** Aggregate every business line for one period (matched by a key function). */
export function periodStats(
  src: Sources,
  matches: (iso: string) => boolean,
  appSettings: AppSettings = readAppSettings(),
): PeriodStats {
  const bills = src.bills.filter((b) => matches(b.bill_date));
  const bookings = src.bookings.filter((b) => matches(b.booking_date) && isFinancialBooking(b));
  const entries = src.tabEntries ?? [];
  // Sales rolled into a merged bill are no longer their own financial record:
  // their revenue is on the bill (see lib/dues.ts / isFinancialSale).
  const sales = src.sales.filter((s) => matches(s.sale_date) && isFinancialSale(s));
  const expenses = src.expenses.filter((e) => matches(e.spent_at));

  // Bills carry tax (GST + any custom taxes); turf bookings and snack sales
  // don't go through the tax settings, so only this loop needs it. Each
  // bill's tax is added on top of its stored (pre-tax) total, mirroring how
  // the printed receipt computes its Grand Total in receipt.ts.
  let billsRevenue = 0;
  let billsTax = 0;
  let billsCollected = 0;
  let billsDues = 0;
  for (const b of bills) {
    // Whole-rupee taxable amount, exactly as billGrossTotal()/the receipt use it.
    const net = rupees(b.total);
    const { taxAmount } = taxBreakdown(net, appSettings);
    const gross = net + taxAmount;
    const onTabBill = (b.payment_mode ?? "") === TAB_PAYMENT_MODE;
    // An "On tab" bill only ever collected what its sources collected; the
    // remainder is a tab charge, so it is not revenue received here.
    const paid = onTabBill
      ? Math.max(0, rupees(b.amount_paid))
      : b.status === "paid"
        ? gross
        : rupees(b.amount_paid);
    // Anything the tab ledger owns for this bill is owed on the Dues tab, not
    // here — counting both would double the same rupee.
    const owned = onTabBill ? gross - paid : netTabAmountFor(entries, TAB_REF_BILL, b.id);
    billsRevenue += net;
    billsTax += taxAmount;
    billsCollected += paid;
    billsDues += Math.max(0, gross - paid - owned);
  }

  const turfRevenue = bookings.reduce((n, b) => n + rupees(b.total_amount), 0);
  const snacksRevenue = sales.reduce((n, s) => n + rupees(s.total), 0);
  const collected =
    billsCollected +
    bookings.reduce((n, b) => n + rupees(b.advance_paid), 0) +
    sales.reduce((n, s) => n + snackSaleCollected(s), 0);
  const spend = expenses.reduce((n, e) => n + rupees(e.amount), 0);
  const dues = billsDues + bookings.reduce((n, b) => n + bookingDue(b, entries), 0);

  // Tax collected is money passed through to the government, not the
  // business's own earnings — profit is based on net (pre-tax) revenue so
  // switching a tax on doesn't inflate reported profit.
  const netRevenue = billsRevenue + turfRevenue + snacksRevenue;
  const revenue = netRevenue + billsTax;
  return {
    billsRevenue,
    turfRevenue,
    snacksRevenue,
    tax: billsTax,
    revenue,
    netRevenue,
    collected,
    expenses: spend,
    profit: netRevenue - spend,
    dues,
    snackProfit: sales.reduce((n, s) => n + rupees(s.profit), 0),
  };
}

export const statsForMonth = (src: Sources, key: string, appSettings?: AppSettings) =>
  periodStats(src, (iso) => monthKey(iso) === key, appSettings);

export const statsForDay = (src: Sources, key: string) =>
  periodStats(src, (iso) => dayKey(iso) === key);

/** Percent change vs a previous value; null when there is no comparable base. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export const PAY_MODE_ORDER = ["Cash", "UPI", "Card", "Pending", "Other"] as const;

const normalizeMode = (mode: string | null | undefined) => {
  const m = (mode ?? "").trim().toLowerCase();
  if (m === "cash") return "Cash";
  if (m === "upi") return "UPI";
  if (m === "card") return "Card";
  if (m === "pending" || m === "") return "Pending";
  return "Other";
};

/** Money actually received in the period, split by how it was paid. */
export function paymentSplit(src: Sources, matches: (iso: string) => boolean) {
  const totals = new Map<string, number>();
  const add = (mode: string | null | undefined, amount: number) => {
    if (amount <= 0) return;
    // "On tab" is not a payment method — nothing was received yet. The money
    // shows up here later, under Cash/UPI, when the tab is collected.
    if ((mode ?? "") === TAB_PAYMENT_MODE) return;
    const key = normalizeMode(mode);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  };

  for (const b of src.bills.filter((x) => matches(x.bill_date)))
    add(b.payment_mode, rupees(b.amount_paid));
  for (const b of src.bookings.filter((x) => matches(x.booking_date) && isFinancialBooking(x)))
    add(b.payment_mode, rupees(b.advance_paid));
  for (const s of src.sales.filter((x) => matches(x.sale_date) && isFinancialSale(x)))
    add(s.payment_mode, snackSaleCollected(s));

  return PAY_MODE_ORDER.filter((m) => (totals.get(m) ?? 0) > 0).map((m) => ({
    name: m,
    value: totals.get(m) ?? 0,
  }));
}

/** Expense totals by category for a period. */
export function expenseByCategory(src: Sources, matches: (iso: string) => boolean) {
  const map = new Map<string, number>();
  for (const e of src.expenses.filter((x) => matches(x.spent_at))) {
    const key = e.category || "Other";
    map.set(key, (map.get(key) ?? 0) + rupees(e.amount));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Month-by-month profit & loss rows, oldest first. */
export function profitAndLoss(src: Sources, keys: string[]) {
  return keys.map((k) => {
    const s = statsForMonth(src, k);
    return {
      key: k,
      month: monthLabel(k),
      Revenue: s.revenue,
      Tax: s.tax,
      Expenses: s.expenses,
      Profit: s.profit,
      Turf: s.turfRevenue,
      Snacks: s.snacksRevenue,
      Bills: s.billsRevenue,
      Collected: s.collected,
      Dues: s.dues,
    };
  });
}

/**
 * GST-ready tax rows, oldest first: taxable value (bills revenue, pre-tax),
 * each active rate slab broken out (CGST/SGST for GST, one line per custom
 * tax), and the total tax collected that month. Tax rates are a single
 * app-wide setting rather than stored per-bill, so — like the rest of the
 * dashboard's tax figures — this applies today's rate retroactively across
 * every month shown; it isn't a record of what each bill charged at the
 * time.
 */
export function taxReport(
  src: Sources,
  keys: string[],
  appSettings: AppSettings = readAppSettings(),
) {
  return keys.map((k) => {
    const s = statsForMonth(src, k, appSettings);
    const { taxAmount, lines } = taxBreakdown(s.billsRevenue, appSettings);
    return {
      key: k,
      month: monthLabel(k),
      taxableValue: s.billsRevenue,
      lines,
      totalTax: taxAmount,
      grossValue: s.billsRevenue + taxAmount,
    };
  });
}
