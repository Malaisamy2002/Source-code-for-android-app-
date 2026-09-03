import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bolt,
  Wrench,
  Package,
  Home,
  Users,
  Truck,
  Dumbbell,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { db, newId, nextExpenseNo, nowIso, sortBy } from "./localdb";
import { readCache, writeCache } from "./data";
import { monthKey as monthKeyCore } from "./analytics";

/** Icon shown next to each expense category. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Electricity: Bolt,
  Maintenance: Wrench,
  "Raw Material": Package,
  Rent: Home,
  "Staff Wages": Users,
  Transport: Truck,
  Equipment: Dumbbell,
  Other: Receipt,
};

export const categoryIcon = (category: string): LucideIcon => CATEGORY_ICONS[category] ?? Receipt;

/**
 * "2026-08" for the month a date falls in, read off the LOCAL calendar.
 * Defaults to the current month when called with no argument.
 *
 * This is a thin wrapper around `monthKey` in `analytics.ts` — that used to
 * be a separate, buggy re-implementation here (using `.toISOString()`,
 * which reads UTC and misreads the month for ~5.5 hours after local
 * midnight on the 1st of every month in IST). Kept as a local export, with
 * its default-argument convenience, so existing call sites don't change.
 */
export const monthKey = (d: Date | string = new Date()) => monthKeyCore(d);

/* ------------------------------- budgets -------------------------------- */

export type Budget = { id: string; month: string; amount: number };

export function useBudgets() {
  return useQuery({
    queryKey: ["expense_budgets"],
    initialData: () => readCache<Budget[]>("expense_budgets", []),
    queryFn: async () => {
      const rows = sortBy(await db.expense_budgets.toArray(), "month", "desc").map((b) => ({
        id: b.id,
        month: b.month,
        amount: Number(b.amount),
      }));
      writeCache("expense_budgets", rows);
      return rows;
    },
  });
}

export function useSetBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { month: string; amount: number }) => {
      const existing = await db.expense_budgets.where("month").equals(payload.month).first();
      if (existing) {
        await db.expense_budgets.update(existing.id, { amount: payload.amount });
      } else {
        await db.expense_budgets.add({
          id: newId(),
          month: payload.month,
          amount: payload.amount,
          created_at: nowIso(),
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense_budgets"] }),
  });
}

/* --------------------------- recurring expenses -------------------------- */

export type RecurringExpense = {
  id: string;
  title: string;
  business: string;
  category: string;
  amount: number;
  day_of_month: number;
  is_active: boolean;
  last_posted_month: string | null;
};

export function useRecurringExpenses() {
  return useQuery({
    queryKey: ["recurring_expenses"],
    initialData: () => readCache<RecurringExpense[]>("recurring_expenses", []),
    queryFn: async () => {
      const rows = sortBy(await db.recurring_expenses.toArray(), "created_at", "desc").map((r) => ({
        id: r.id,
        title: r.title,
        business: r.business,
        category: r.category,
        amount: Number(r.amount),
        day_of_month: r.day_of_month,
        is_active: r.is_active,
        last_posted_month: r.last_posted_month,
      }));
      writeCache("recurring_expenses", rows);
      return rows;
    },
  });
}

export function useAddRecurringExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      title: string;
      business: string;
      category: string;
      amount: number;
      day_of_month: number;
    }) => {
      await db.recurring_expenses.add({
        id: newId(),
        ...payload,
        is_active: true,
        last_posted_month: null,
        created_at: nowIso(),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_expenses"] }),
  });
}

export function useToggleRecurringExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; is_active: boolean }) => {
      await db.recurring_expenses.update(payload.id, { is_active: payload.is_active });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_expenses"] }),
  });
}

export function useDeleteRecurringExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await db.recurring_expenses.delete(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_expenses"] }),
  });
}

/**
 * Posts every active recurring expense whose day has arrived this month and
 * which hasn't been posted yet. Returns how many were added.
 */
export function useRunRecurringExpenses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rules: RecurringExpense[]) => {
      const now = new Date();
      const month = monthKey(now);
      const due = rules.filter(
        (r) => r.is_active && r.last_posted_month !== month && now.getDate() >= r.day_of_month,
      );
      if (due.length === 0) return 0;
      for (const r of due) {
        const expense_no = await nextExpenseNo();
        const spent = new Date(now.getFullYear(), now.getMonth(), r.day_of_month, 12);
        await db.expenses.add({
          id: newId(),
          expense_no,
          business: r.business,
          category: r.category,
          description: r.title,
          note: "Auto-added recurring expense",
          amount: r.amount,
          spent_at: spent.toISOString(),
          receipt_path: null,
          created_at: nowIso(),
        });
        await db.recurring_expenses.update(r.id, { last_posted_month: month });
      }
      return due.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses_v2"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["recurring_expenses"] });
    },
  });
}

/* -------------------------------- receipts ------------------------------- */

/** Stores a receipt photo as a blob in IndexedDB and returns its local path key. */
export async function uploadReceipt(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `receipts/${newId()}.${ext}`;
  const blob = file.slice(0, file.size, file.type || "image/jpeg");
  await db.receipts.put({ path, blob, created_at: nowIso() });
  return path;
}

/** Object URL for viewing a stored receipt. Revoke it when done. */
export async function receiptUrl(path: string) {
  const row = await db.receipts.get(path);
  if (!row) throw new Error("Receipt not found on this device");
  return URL.createObjectURL(row.blob);
}
