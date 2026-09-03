import { describe, expect, it } from "vitest";

import { mergeMath } from "./merge";
import { netTabAmountFor } from "./dues";
import { TAB_REF_MERGE_REVERSE, TAB_REF_TURF_BOOKING, tabBalanceOf, type TabEntry } from "./tabs";

const entry = (over: Partial<TabEntry>): TabEntry =>
  ({
    id: Math.random().toString(36).slice(2),
    tab_id: "t1",
    customer_key: "p:9876543210",
    kind: "charge",
    business: "Turf",
    amount: 0,
    note: null,
    ref_type: null,
    ref_id: null,
    source_ref_type: null,
    source_ref_id: null,
    entry_date: "2026-09-01",
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  }) as TabEntry;

describe("mergeMath()", () => {
  it("nets collections and tab charges into whole rupees", () => {
    const m = mergeMath(2500, [
      { collected: 500.4, onTab: 1000.5 },
      { collected: 0, onTab: 0 },
    ]);
    expect(m.total).toBe(2500);
    expect(m.collected).toBe(500);
    expect(m.alreadyOnTab).toBe(1001);
    expect(m.outstanding).toBe(2000);
    expect(m.tabDelta).toBe(999);
  });

  it("keeps collected + outstanding equal to the bill total", () => {
    for (const [total, collected] of [
      [1000, 0],
      [1000, 400],
      [1000, 1000],
      [1237, 618.5],
    ] as const) {
      const m = mergeMath(total, [{ collected, onTab: 0 }]);
      expect(m.collected + m.outstanding).toBe(m.total);
    }
  });

  it("never treats an over-collection as negative outstanding", () => {
    const m = mergeMath(800, [{ collected: 1000, onTab: 0 }]);
    expect(m.collected).toBe(800);
    expect(m.outstanding).toBe(0);
  });

  it("tabDelta is the net change to the customer's balance", () => {
    // Sources had ₹1,500 on the tab; merged bill puts ₹1,500 back on it.
    const m = mergeMath(1500, [{ collected: 0, onTab: 1500 }]);
    expect(m.outstanding).toBe(1500);
    expect(m.tabDelta).toBe(0);
  });
});

describe("merge reversal invariants", () => {
  const billId = "bill1";
  const bookingId = "book1";

  // A booking that put ₹1,200 on the tab, then got merged: the merge writes a
  // payment tagged merge_reverse against the bill, sourced to the booking.
  const charge = entry({
    kind: "charge",
    amount: 1200,
    ref_type: TAB_REF_TURF_BOOKING,
    ref_id: bookingId,
  });
  const reversal = entry({
    kind: "payment",
    amount: 1200,
    ref_type: TAB_REF_MERGE_REVERSE,
    ref_id: billId,
    source_ref_type: TAB_REF_TURF_BOOKING,
    source_ref_id: bookingId,
  });

  it("leaves nothing on the customer's balance for a merged source", () => {
    const ledger = [charge, reversal];
    // The reversal is a payment row, so the tab balance nets to zero…
    expect(tabBalanceOf(ledger)).toBe(0);
    // …while the source ref keeps its gross charge, which is exactly the
    // amount the un-merge has to put back (it deletes the reversal row).
    expect(netTabAmountFor(ledger, TAB_REF_TURF_BOOKING, bookingId)).toBe(1200);
  });

  it("restores the source charge exactly when un-merged", () => {
    // un-merge drops the merge_reverse row and re-charges the difference
    const afterUnmerge = [charge];
    expect(netTabAmountFor(afterUnmerge, TAB_REF_TURF_BOOKING, bookingId)).toBe(1200);
  });

  it("a repeat un-merge restores nothing extra", () => {
    // The reversal rows are deleted by the first un-merge, so a second pass
    // finds none and writes nothing.
    const afterUnmerge = [charge];
    expect(afterUnmerge.filter((e) => e.ref_type === TAB_REF_MERGE_REVERSE)).toHaveLength(0);
    expect(tabBalanceOf(afterUnmerge)).toBe(1200);
  });

  it("partially collected source keeps only the remaining charge on the tab", () => {
    const partPaid = entry({
      kind: "payment",
      amount: 200,
      ref_type: TAB_REF_TURF_BOOKING,
      ref_id: bookingId,
    });
    expect(netTabAmountFor([charge, partPaid], TAB_REF_TURF_BOOKING, bookingId)).toBe(1000);
    expect(tabBalanceOf([charge, partPaid])).toBe(1000);
    const m = mergeMath(1200, [{ collected: 200, onTab: 1000 }]);
    expect(m.outstanding).toBe(1000);
    expect(m.tabDelta).toBe(0);
  });
});
