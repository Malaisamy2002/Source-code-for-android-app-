import { describe, expect, it } from "vitest";

import { planRecurringPosts, type RecurringExpense } from "./expenses";

const rule = (over: Partial<RecurringExpense> = {}): RecurringExpense => ({
  id: Math.random().toString(36).slice(2),
  title: "Net repair",
  business: "Turf",
  category: "Equipment",
  amount: 500,
  day_of_month: 5,
  is_active: true,
  last_posted_month: null,
  ...over,
});

describe("planRecurringPosts()", () => {
  it("posts an active rule once its day has arrived in the IST month", () => {
    // 2026-09-06 12:00 IST = 06:30 UTC
    const now = new Date("2026-09-06T06:30:00.000Z");
    const plan = planRecurringPosts([rule({ day_of_month: 5 })], now);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.spent_at).toBe("2026-09-05");
  });

  it("waits until the rule's day of month", () => {
    const now = new Date("2026-09-04T06:30:00.000Z"); // Sep 4 IST
    expect(planRecurringPosts([rule({ day_of_month: 5 })], now)).toHaveLength(0);
  });

  it("stores a plain YYYY-MM-DD date, never a UTC timestamp", () => {
    // Regression: auto-posted rows used to store spent.toISOString(), so
    // plain-date equality filters (day filter, receipt folder) never matched.
    const now = new Date("2026-09-06T06:30:00.000Z");
    const plan = planRecurringPosts([rule()], now);
    expect(plan[0]?.spent_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the IST day even when UTC is still on the previous day", () => {
    // 2026-09-01 02:00 IST is 2026-08-31 20:30 UTC: a rule for the 1st is due.
    const now = new Date("2026-08-31T20:30:00.000Z");
    const plan = planRecurringPosts([rule({ day_of_month: 1 })], now);
    expect(plan[0]?.spent_at).toBe("2026-09-01");
  });

  it("clamps the 31st to the last day of shorter months instead of rolling over", () => {
    // Feb 2026 has 28 days; new Date(y, m, 31) would roll into March.
    const now = new Date("2026-02-28T06:30:00.000Z"); // Feb 28 IST
    const plan = planRecurringPosts([rule({ day_of_month: 31 })], now);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.spent_at).toBe("2026-02-28");
  });

  it("does not roll the 31st into next month's key", () => {
    const now = new Date("2026-02-28T06:30:00.000Z");
    const plan = planRecurringPosts([rule({ day_of_month: 31 })], now);
    expect(plan[0]?.spent_at.startsWith("2026-02")).toBe(true);
  });

  it("skips rules already posted this month and inactive rules", () => {
    const now = new Date("2026-09-06T06:30:00.000Z");
    expect(
      planRecurringPosts([rule({ last_posted_month: "2026-09" })], now),
    ).toHaveLength(0);
    expect(planRecurringPosts([rule({ is_active: false })], now)).toHaveLength(0);
  });

  it("posts again next month even after posting this month", () => {
    const now = new Date("2026-10-06T06:30:00.000Z");
    const plan = planRecurringPosts([rule({ last_posted_month: "2026-09" })], now);
    expect(plan[0]?.spent_at).toBe("2026-10-05");
  });
});
