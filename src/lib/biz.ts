import { money, rupees } from "./money";
import { readAppSettings, taxBreakdown } from "./settings";

export const BUSINESS_NAME = "Chennai Soccer & Sports School";

export type CalcRow = {
  id: string;
  item: string;
  rate: number;
  qty: number;
  unit: Unit;
};

export type BillItem = {
  item: string;
  rate: number;
  qty: number;
  total: number;
  unit: Unit;
};

/** Editable unit tags shown on each calculator row and printed on bills. */
export const UNITS = ["kg", "litre", "hr", "pcs", "box", "pkt", "dozen", "g"] as const;
export type Unit = (typeof UNITS)[number];
export const DEFAULT_UNIT: Unit = "kg";

export type BillStatus = "paid" | "unpaid" | "partial";

export type Bill = {
  id: string;
  invoice_no: string;
  customer_name: string;
  customer_phone: string | null;
  items: BillItem[];
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  status: BillStatus;
  payment_mode?: string | null;
  bill_date: string;
};

export type Expense = {
  id: string;
  category: string;
  note: string | null;
  amount: number;
  spent_at: string;
};

export type HistoryEntry = {
  id: string;
  rows: BillItem[];
  total: number;
  note: string | null;
  created_at: string;
};

export const EXPENSE_CATEGORIES = [
  "ingredients",
  "packaging",
  "transport",
  "labour",
  "other",
] as const;

export const rowTotal = (r: Pick<CalcRow, "rate" | "qty">) =>
  rupees((Number(r.rate) || 0) * (Number(r.qty) || 0));

export { money };

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

/**
 * Bill/booking/snack-sale display date as "DD-MM-YYYY" — the one format
 * every printed bill, booking receipt, and snack-sale receipt (plus their
 * in-app list/detail views) must use, per the "date-month-year" requirement.
 *
 * `booking_date` and `sale_date` are stored as bare "YYYY-MM-DD" local
 * calendar-date strings (see localDateStr in utils.ts). Passing those to
 * `new Date(...)` parses them as UTC midnight per the JS spec — the exact
 * off-by-one-day trap localDateStr's own comment warns about — so this
 * formats date-only strings by splitting the string directly instead of
 * going through a Date object. `bill_date` is a full ISO timestamp (see
 * nowIso in localdb.ts); for that shape, Date's local getters are safe.
 */
export const formatDMY = (iso: string): string => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return `${d}-${m}-${y}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // fall back to the raw string rather than "Invalid Date"
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${d.getFullYear()}`;
};

export function historyEntryText(entry: HistoryEntry) {
  const lines = entry.rows.map(
    (r) =>
      `${r.item || "Item"} — ${r.qty} ${r.unit ?? "kg"} × ${money(r.rate)} = ${money(r.total)}`,
  );
  return [
    `${BUSINESS_NAME}`,
    shortDate(entry.created_at),
    ...lines,
    `Total: ${money(entry.total)}`,
  ].join("\n");
}

export function billText(bill: Bill) {
  const lines = bill.items.map(
    (r) =>
      `${r.item || "Item"} — ${r.qty} ${r.unit ?? "kg"} × ${money(r.rate)} = ${money(r.total)}`,
  );
  const gross = billGrossTotal(bill);
  const paid = billPaidAmount(bill);
  const due = Math.max(0, gross - paid);
  return [
    `${BUSINESS_NAME}`,
    `Bill ${bill.invoice_no} · ${formatDMY(bill.bill_date)}`,
    `Customer: ${bill.customer_name}`,
    "",
    ...lines,
    "",
    `Subtotal: ${money(bill.subtotal)}`,
    bill.discount ? `Discount: -${money(bill.discount)}` : "",
    `Payable: ${money(gross)}`,
    `Paid: ${money(paid)}`,
    due > 0 ? `Balance due: ${money(due)}` : "",
    `Status: ${bill.status.toUpperCase()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function whatsappUrl(text: string, phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const to = digits.length >= 10 ? (digits.length === 10 ? `91${digits}` : digits) : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function balanceOf(bill: Bill) {
  if (bill.status === "paid") return 0;
  return Math.max(0, billGrossTotal(bill) - rupees(bill.amount_paid));
}

/** Bill total with every active tax (GST + custom taxes) added on top —
 * the actual amount owed by the customer. `bill.total` alone is the
 * post-discount, pre-tax figure recorded when the bill was made (discount is
 * always applied BEFORE tax). Always a whole rupee. */
export function billGrossTotal(bill: Bill): number {
  const taxable = rupees(bill.total);
  const { taxAmount } = taxBreakdown(taxable, readAppSettings());
  return taxable + taxAmount;
}

/** What's actually been paid toward a bill's tax-inclusive total — full
 * gross amount once marked "paid", otherwise whatever's been recorded. */
export function billPaidAmount(bill: Bill): number {
  return bill.status === "paid" ? billGrossTotal(bill) : Number(bill.amount_paid) || 0;
}

/** Case/whitespace-insensitive name match, used to tie free-text customer_name
 * fields on bills/bookings/sales back to a saved customer. */
export const sameCustomerName = (a: string | null | undefined, b: string) =>
  (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/** Visits at or above this count earn the VIP tag; below it, "Regular". */
export const VIP_VISIT_THRESHOLD = 5;

export type CustomerTag = "VIP" | "Regular" | "New";

export function customerTag(visits: number): CustomerTag {
  if (visits >= VIP_VISIT_THRESHOLD) return "VIP";
  if (visits > 0) return "Regular";
  return "New";
}
