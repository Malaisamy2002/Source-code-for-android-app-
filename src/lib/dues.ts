/**
 * The ONE source of truth for "what is still owed".
 *
 * A rupee of due can live in exactly one of three places:
 *   1. a turf booking's unpaid balance (Turf tab),
 *   2. a bill's unpaid balance (Bills tab / merged bills),
 *   3. the customer's running tab ledger (Dues tab).
 *
 * Whenever an operator moves a due (turf "Put balance on tab", a snack bill
 * paid "On tab", or a merged bill) the ledger gets a charge and this module
 * subtracts that exact amount from the source record — so Turf, Snacks, Dues,
 * Bills, Customers and Reports can never disagree, and no rupee is counted
 * twice.
 */

import { balanceOf, billGrossTotal, type Bill } from "./biz";
import { rupees } from "./money";
import { TAB_PAYMENT_MODE, type SnackSale, type TurfBooking } from "./ops";

import {
  TAB_REF_BILL,
  TAB_REF_MERGE_REVERSE,
  TAB_REF_SNACK_SALE,
  TAB_REF_TURF_BOOKING,
  tabKey,
  type TabEntry,
} from "./tabs";

const num = (v: unknown) => Number(v) || 0;
/** Every due is a whole rupee — see lib/money.ts for the single rule. */
const round2 = rupees;

/**
 * Net amount still sitting on a tab for one source record: charges made
 * against it minus any payments/reversals recorded against the same ref.
 * Never negative — an over-collection belongs to the tab, not to the record.
 */
export function netTabAmountFor(
  entries: TabEntry[],
  refType: string,
  refId: string | null | undefined,
) {
  if (!refId) return 0;
  let net = 0;
  for (const e of entries) {
    if (e.ref_type !== refType || e.ref_id !== refId) continue;
    net += e.kind === "charge" ? num(e.amount) : -num(e.amount);
  }
  return Math.max(0, round2(net));
}

/**
 * The ONE place that decides whether a turf booking is still its own
 * financial record: not Cancelled, and not merged into a bill (a merged
 * booking's money lives on that bill). Every revenue/dues/advance sum in the
 * app must filter through this instead of re-writing the two clauses inline.
 *
 * Do NOT use it for non-money booking counts (e.g. "visits") — a merged
 * booking still happened as an event.
 */
export const isFinancialBooking = (b: Pick<TurfBooking, "status" | "merged_into_bill_id">) =>
  b.status !== "Cancelled" && !b.merged_into_bill_id;

/**
 * Snack sales rolled into a merged bill stay in the database (their tab
 * charges must keep a traceable parent) but stop being their own financial
 * record — mirror of `isFinancialBooking` for sales.
 */
export const isFinancialSale = (s: Pick<SnackSale, "merged_into_bill_id">) =>
  !s.merged_into_bill_id;

/** Money still owed on a turf booking itself (0 once merged / on the tab). */
export function bookingDue(b: TurfBooking, entries: TabEntry[] = []) {
  if (!isFinancialBooking(b)) return 0;
  const raw = num(b.total_amount) - num(b.advance_paid);
  const onTab = netTabAmountFor(entries, TAB_REF_TURF_BOOKING, b.id);
  return Math.max(0, round2(raw - onTab));
}

/**
 * Money still owed on a bill itself.
 *
 * A bill saved as "On tab" is owned by the running tab — its remainder is
 * already a tab charge, so the bill's own due is 0 and the money is counted
 * exactly once. Any other bill owes `total - amount_paid`, less anything that
 * was separately pushed onto the tab against it.
 */
export function billDue(bill: Bill, entries: TabEntry[] = []) {
  if ((bill.payment_mode ?? "") === TAB_PAYMENT_MODE) return 0;
  const onTab = netTabAmountFor(entries, TAB_REF_BILL, bill.id);
  return Math.max(0, round2(balanceOf(bill) - onTab));
}

/**
 * A snack sale never carries a due of its own: it is either paid at the
 * counter or billed "On tab", in which case the tab ledger owns the money.
 */
export const snackSaleDue = () => 0;

export type DueLine = {
  kind: "tab" | "booking" | "bill";
  label: string;
  amount: number;
  date: string;
};

export type CustomerDues = {
  tab: number;
  bookings: number;
  bills: number;
  total: number;
  lines: DueLine[];
};

/**
 * Everything one customer owes, with the contributing rows so any screen can
 * show the breakdown instead of re-deriving it.
 */
export function customerOutstanding(
  customer: { name: string; phone?: string | null },
  src: {
    bills?: Bill[];
    bookings?: TurfBooking[];
    tabEntries?: TabEntry[];
    tabBalance?: number;
    /**
     * Optional record matcher. Defaults to tab-identity (phone, else name).
     * Screens that group by display name pass their own name comparison so a
     * record saved without a phone still lands on the right customer.
     */
    match?: (name: string | null | undefined, phone: string | null | undefined) => boolean;
  },
): CustomerDues {
  const key = tabKey(customer.name, customer.phone ?? null);
  const belongs =
    src.match ??
    ((n: string | null | undefined, p: string | null | undefined) => tabKey(n, p) === key);
  const entries = (src.tabEntries ?? []).filter((e) => e.customer_key === key);

  // An over-collected tab is credit, not a negative due: clamp at 0 so it can
  // never cancel out a real booking/bill due elsewhere in the total.
  const tab = Math.max(
    0,
    src.tabBalance ??
      round2(
        entries.reduce((s, e) => s + (e.kind === "charge" ? num(e.amount) : -num(e.amount)), 0),
      ),
  );

  const lines: DueLine[] = [];
  if (tab > 0) lines.push({ kind: "tab", label: "Running tab", amount: tab, date: "" });

  let bookings = 0;
  for (const b of src.bookings ?? []) {
    if (!belongs(b.customer_name, b.phone)) continue;
    const due = bookingDue(b, entries);
    if (due <= 0) continue;
    bookings += due;
    lines.push({
      kind: "booking",
      label: `Booking ${b.booking_no}`,
      amount: due,
      date: b.booking_date,
    });
  }

  let bills = 0;
  for (const bill of src.bills ?? []) {
    if (!belongs(bill.customer_name, bill.customer_phone)) continue;
    const due = billDue(bill, entries);
    if (due <= 0) continue;
    bills += due;
    lines.push({
      kind: "bill",
      label: `Bill ${bill.invoice_no}`,
      amount: due,
      date: bill.bill_date,
    });
  }

  return {
    tab: round2(tab),
    bookings: round2(bookings),
    bills: round2(bills),
    total: round2(tab + bookings + bills),
    lines,
  };
}

/**
 * Money actually received against a bill.
 *
 * An "On tab" bill is stored with `amount_paid` = what was really collected on
 * the source records, and the remainder sits on the tab — so "On tab" is never
 * treated as a payment method and revenue is never inflated.
 */
export function billCollected(bill: Bill) {
  if ((bill.payment_mode ?? "") === TAB_PAYMENT_MODE) return Math.max(0, rupees(bill.amount_paid));
  // A bill marked paid has a zero balance, so its collected amount is the full
  // gross total (tax included) regardless of what `amount_paid` was left at.
  return bill.status === "paid" ? round2(billGrossTotal(bill)) : rupees(bill.amount_paid);
}

/** Money actually received for a snack sale (an "On tab" sale collects nothing). */
export function snackSaleCollected(s: Pick<SnackSale, "payment_mode" | "total">) {
  return s.payment_mode === TAB_PAYMENT_MODE ? 0 : rupees(s.total);
}

/** Human label for a snack sale's tab/merge state (used by the Snacks list). */
export function saleStateLabel(
  s: Pick<SnackSale, "merged_into_bill_id" | "payment_mode">,
  invoiceNo?: string | null,
) {
  if (s.merged_into_bill_id) return invoiceNo ? `Merged into ${invoiceNo}` : "Merged into bill";
  if (s.payment_mode === TAB_PAYMENT_MODE) return "On tab";
  return null;
}

/** Human label for a booking's tab/merge state (used by the Turf list). */
export function bookingStateLabel(
  b: Pick<TurfBooking, "id" | "merged_into_bill_id">,
  entries: TabEntry[] = [],
  invoiceNo?: string | null,
) {
  if (b.merged_into_bill_id) return invoiceNo ? `Merged into ${invoiceNo}` : "Merged into bill";
  if (netTabAmountFor(entries, TAB_REF_TURF_BOOKING, b.id) > 0) return "On tab";
  return null;
}

export type LedgerGroup = {
  key: string;
  /** Human label naming the source record ("Booking B-12", "Manual due"). */
  label: string;
  refType: string | null;
  refId: string | null;
  charged: number;
  paid: number;
  /** Still sitting on the tab for this source (never negative). */
  net: number;
  /** Most recent activity date for the group. */
  date: string;
};

/**
 * Group one customer's tab ledger into one line per source record, so the Dues
 * tab can show WHERE a balance came from instead of a flat list of entries.
 *
 * Loose payments (no ref) and manual dues collapse into their own lines; a
 * `merge_reverse` entry is netted against the source it was pulled off, which
 * is exactly why a merged booking/sale disappears from the tab breakdown.
 */
export function groupTabLedger(
  entries: TabEntry[],
  src: {
    bills?: Pick<Bill, "id" | "invoice_no">[];
    bookings?: Pick<TurfBooking, "id" | "booking_no">[];
    sales?: Pick<SnackSale, "id" | "bill_no">[];
  } = {},
): LedgerGroup[] {
  const billNo = new Map((src.bills ?? []).map((b) => [b.id, b.invoice_no]));
  const bookingNo = new Map((src.bookings ?? []).map((b) => [b.id, b.booking_no]));
  const saleNo = new Map((src.sales ?? []).map((s) => [s.id, s.bill_no]));

  const labelFor = (refType: string | null, refId: string | null, note: string | null) => {
    if (refType === TAB_REF_TURF_BOOKING)
      return `Booking ${bookingNo.get(refId ?? "") ?? "(removed)"}`;
    if (refType === TAB_REF_SNACK_SALE)
      return `Snack bill ${saleNo.get(refId ?? "") ?? "(removed)"}`;
    if (refType === TAB_REF_BILL) return `Bill ${billNo.get(refId ?? "") ?? "(removed)"}`;
    return note?.trim() || "Manual entry";
  };

  const groups = new Map<string, LedgerGroup>();
  for (const e of entries) {
    // A merge reversal belongs to the source it cancels, not to a line of its own.
    const refType =
      e.ref_type === TAB_REF_MERGE_REVERSE ? (e.source_ref_type ?? null) : (e.ref_type ?? null);
    const refId =
      e.ref_type === TAB_REF_MERGE_REVERSE ? (e.source_ref_id ?? null) : (e.ref_id ?? null);
    const key = refType && refId ? `${refType}:${refId}` : `free:${e.kind}`;
    const g = groups.get(key) ?? {
      key,
      label:
        refType && refId
          ? labelFor(refType, refId, e.note)
          : e.kind === "payment"
            ? "Payments received"
            : "Manual dues",
      refType,
      refId,
      charged: 0,
      paid: 0,
      net: 0,
      date: "",
    };
    if (e.kind === "charge") g.charged = round2(g.charged + num(e.amount));
    else g.paid = round2(g.paid + num(e.amount));
    g.net = round2(g.charged - g.paid);
    if (e.entry_date > g.date) g.date = e.entry_date;
    groups.set(key, g);
  }

  return [...groups.values()].sort((a, b) => b.net - a.net || b.date.localeCompare(a.date));
}
