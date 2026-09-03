import { describe, expect, it } from "vitest";

import { periodStats, type Sources } from "./analytics";
import type { Bill } from "./biz";
import type { ExpenseV2, SnackSale, TurfBooking } from "./ops";
import { TAB_PAYMENT_MODE } from "./ops";
import { TAB_REF_BILL, type TabEntry } from "./tabs";
import type { AppSettings } from "./settings";
import { DEFAULT_APP_SETTINGS } from "./settings";

const DATE = "2026-09-01";
const matches = () => true;
const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  ...over,
});

const bill = (over: Partial<Bill> = {}): Bill =>
  ({
    id: "b1",
    invoice_no: "INV-1",
    customer_name: "Ravi",
    customer_phone: "9876543210",
    items: [],
    subtotal: 1000,
    discount: 0,
    total: 1000,
    amount_paid: 0,
    status: "unpaid",
    payment_mode: "Cash",
    bill_date: DATE,
    ...over,
  }) as Bill;

const booking = (over: Partial<TurfBooking> = {}): TurfBooking =>
  ({
    id: "k1",
    booking_no: "B-1",
    customer_name: "Ravi",
    phone: "9876543210",
    booking_date: DATE,
    total_amount: 1000,
    advance_paid: 0,
    status: "Booked",
    payment_mode: "Cash",
    merged_into_bill_id: null,
    ...over,
  }) as unknown as TurfBooking;

const sale = (over: Partial<SnackSale> = {}): SnackSale =>
  ({
    id: "s1",
    bill_no: "S-1",
    sale_date: DATE,
    total: 500,
    profit: 200,
    payment_mode: "Cash",
    merged_into_bill_id: null,
    ...over,
  }) as unknown as SnackSale;

const expense = (over: Partial<ExpenseV2> = {}): ExpenseV2 =>
  ({
    id: "e1",
    category: "ingredients",
    note: null,
    amount: 300,
    spent_at: DATE,
    ...over,
  }) as unknown as ExpenseV2;

const entry = (over: Partial<TabEntry>): TabEntry =>
  ({
    id: Math.random().toString(36).slice(2),
    tab_id: "t1",
    customer_key: "p:9876543210",
    kind: "charge",
    business: "Shared",
    amount: 0,
    note: null,
    ref_type: null,
    ref_id: null,
    source_ref_type: null,
    source_ref_id: null,
    entry_date: DATE,
    created_at: `${DATE}T00:00:00.000Z`,
    ...over,
  }) as TabEntry;

const src = (over: Partial<Sources> = {}): Sources => ({
  bills: [],
  bookings: [],
  sales: [],
  expenses: [],
  tabEntries: [],
  ...over,
});

describe("periodStats() revenue", () => {
  it("revenue = netRevenue + tax, and lines add up to netRevenue", () => {
    const s = periodStats(
      src({ bills: [bill()], bookings: [booking()], sales: [sale()] }),
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    expect(s.netRevenue).toBe(s.billsRevenue + s.turfRevenue + s.snacksRevenue);
    expect(s.revenue).toBe(s.netRevenue + s.tax);
    expect(s.tax).toBe(180);
    expect(s.revenue).toBe(2680);
  });

  it("profit ignores tax so switching GST on never inflates it", () => {
    const source = src({ bills: [bill()], expenses: [expense()] });
    const off = periodStats(source, matches, settings());
    const on = periodStats(source, matches, settings({ gstEnabled: true, gstRate: 18 }));
    expect(off.profit).toBe(700);
    expect(on.profit).toBe(off.profit);
    expect(on.revenue).toBeGreaterThan(off.revenue);
  });

  it("taxes the post-discount total, not the subtotal", () => {
    const s = periodStats(
      src({ bills: [bill({ subtotal: 1000, discount: 200, total: 800 })] }),
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    expect(s.billsRevenue).toBe(800);
    expect(s.tax).toBe(144);
    expect(s.revenue).toBe(944);
  });

  it("rounds every line to whole rupees", () => {
    const s = periodStats(
      src({
        bills: [bill({ total: 999.5 })],
        bookings: [booking({ total_amount: 250.4, advance_paid: 100.5 })],
        sales: [sale({ total: 49.5 })],
        expenses: [expense({ amount: 10.4 })],
      }),
      matches,
      settings(),
    );
    for (const v of [
      s.billsRevenue,
      s.turfRevenue,
      s.snacksRevenue,
      s.collected,
      s.expenses,
      s.dues,
      s.revenue,
    ])
      expect(Number.isInteger(v)).toBe(true);
    expect(s.billsRevenue).toBe(1000);
    expect(s.turfRevenue).toBe(250);
    expect(s.expenses).toBe(10);
  });
});

describe("periodStats() collected", () => {
  it("never counts an 'On tab' snack sale as collected", () => {
    const s = periodStats(
      src({ sales: [sale({ payment_mode: TAB_PAYMENT_MODE })] }),
      matches,
      settings(),
    );
    expect(s.snacksRevenue).toBe(500);
    expect(s.collected).toBe(0);
  });

  it("counts an 'On tab' bill only for what its sources actually collected", () => {
    const s = periodStats(
      src({
        bills: [bill({ payment_mode: TAB_PAYMENT_MODE, amount_paid: 300, status: "partial" })],
      }),
      matches,
      settings(),
    );
    expect(s.collected).toBe(300);
    // The remaining ₹700 is owned by the tab ledger, so it isn't a bill due.
    expect(s.dues).toBe(0);
  });

  it("counts a paid bill's full gross total, tax included", () => {
    const s = periodStats(
      src({ bills: [bill({ status: "paid", amount_paid: 1000 })] }),
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    expect(s.collected).toBe(1180);
    expect(s.dues).toBe(0);
  });

  it("counts turf advances, not the whole booking", () => {
    const s = periodStats(
      src({ bookings: [booking({ total_amount: 1000, advance_paid: 400 })] }),
      matches,
      settings(),
    );
    expect(s.turfRevenue).toBe(1000);
    expect(s.collected).toBe(400);
    expect(s.dues).toBe(600);
  });
});

describe("periodStats() dues", () => {
  it("never double-counts money the tab ledger already owns", () => {
    const b = bill({ amount_paid: 0 });
    const withTab = periodStats(
      src({
        bills: [b],
        tabEntries: [entry({ kind: "charge", amount: 1000, ref_type: TAB_REF_BILL, ref_id: b.id })],
      }),
      matches,
      settings(),
    );
    expect(withTab.dues).toBe(0);

    const withoutTab = periodStats(src({ bills: [b] }), matches, settings());
    expect(withoutTab.dues).toBe(1000);
  });

  it("subtracts only the part of a booking that moved onto the tab", () => {
    const k = booking({ total_amount: 1000, advance_paid: 200 });
    const s = periodStats(
      src({
        bookings: [k],
        tabEntries: [
          entry({ kind: "charge", amount: 500, ref_type: "turf_booking", ref_id: k.id }),
        ],
      }),
      matches,
      settings(),
    );
    expect(s.dues).toBe(300);
  });

  it("excludes cancelled and merged records from every figure", () => {
    const s = periodStats(
      src({
        bookings: [
          booking({ id: "x1", status: "Cancelled" }),
          booking({ id: "x2", merged_into_bill_id: "bill9" }),
        ],
        sales: [sale({ id: "y1", merged_into_bill_id: "bill9" })],
      }),
      matches,
      settings(),
    );
    expect(s.turfRevenue).toBe(0);
    expect(s.snacksRevenue).toBe(0);
    expect(s.collected).toBe(0);
    expect(s.dues).toBe(0);
  });
});
