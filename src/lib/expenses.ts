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
import { monthKey as monthKeyCore, dayKey } from "./analytics";
import { appDocumentAbsPath, appDocumentExists, isDesktop, saveToAppDocuments } from "./desktop";

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
 * Pure plan for one auto-posting run: which rules are due on `now`, and the
 * plain "YYYY-MM-DD" each post should carry. Extracted from the mutation so
 * the date rules are unit-testable without a database.
 *
 * Date rules:
 * - Month and day-of-month come from the IST calendar (monthKey/dayKey), NOT
 *   `now.getDate()` — that reads the runtime's local timezone and disagrees
 *   with monthKey() anywhere not already set to IST.
 * - `spent_at` is a plain local date, matching every other expense row. It
 *   used to be `spent.toISOString()` — a full UTC timestamp that plain-date
 *   equality filters (ExpensesTab day filter, uploadReceipt folder) silently
 *   never matched.
 * - A rule for "the 31st" posts on the LAST day of shorter months (clamped),
 *   never rolls over into the next month like the Date constructor did.
 */
export function planRecurringPosts(
  rules: RecurringExpense[],
  now: Date = new Date(),
): { rule: RecurringExpense; spent_at: string }[] {
  const month = monthKey(now); // IST month key
  const todayDay = Number(dayKey(now).slice(8, 10));
  const [y = 0, mo = 1] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // clamp e.g. the 31st in Feb
  return rules
    .filter(
      (r) =>
        r.is_active &&
        r.last_posted_month !== month &&
        todayDay >= Math.min(r.day_of_month, lastDay),
    )
    .map((rule) => ({
      rule,
      spent_at: `${month}-${String(Math.min(rule.day_of_month, lastDay)).padStart(2, "0")}`,
    }));
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
      const due = planRecurringPosts(rules, now);
      if (due.length === 0) return 0;
      for (const { rule: r, spent_at } of due) {
        const expense_no = await nextExpenseNo();
        await db.expenses.add({
          id: newId(),
          expense_no,
          business: r.business,
          category: r.category,
          description: r.title,
          note: "Auto-added recurring expense",
          amount: r.amount,
          spent_at,
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

/* -------------------------------- receipts -------------------------------
 *
 * Web/PWA build: photos are stored as blobs inside the app's IndexedDB
 * (`db.receipts`), keyed by a generated path. Fine for a browser sandbox,
 * but on the desktop build it bloats the app's database file with binary
 * data the OS can't see or back up on its own.
 *
 * Desktop (Tauri) build: photos are instead written as real files on disk,
 * under `Documents/TurfApp/Receipts/<YYYY-MM-DD>/` — one subfolder per
 * expense date, right where the person can find it in Explorer (not buried
 * in the hidden AppData folder). Nothing is created until an expense
 * actually has a photo attached: no date folder is made in advance, and a
 * day with no expenses never gets one. `receipt_path` on the expense row
 * always stores the relative path (`Receipts/2026-09-04/xxxx.jpg`); on
 * desktop that's resolved against `Documents/TurfApp`, on web it's the
 * IndexedDB key, so the rest of the app never needs to know which mode it's
 * in.
 * ------------------------------------------------------------------------ */

/**
 * Stores a receipt photo for the given expense date and returns its
 * relative path (`Receipts/<date>/<id>.<ext>`).
 *
 * `date` should be the expense's `spent_at` (YYYY-MM-DD); it's only used to
 * pick the subfolder name on desktop and is ignored on web.
 */
export async function uploadReceipt(file: File, date: string = dayKey(new Date())) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `Receipts/${date}/${newId()}.${ext}`;

  if (isDesktop()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await saveToAppDocuments(path, bytes);
    return path;
  }

  const blob = file.slice(0, file.size, file.type || "image/jpeg");
  await db.receipts.put({ path, blob, created_at: nowIso() });
  return path;
}

/**
 * Opens a stored receipt for viewing.
 *
 * Desktop: hands the absolute file path to the OS's default photo viewer
 * (via `tauri-plugin-opener`) — no browser tab/popup involved, so it can't
 * get silently blocked the way `window.open` can.
 *
 * Web: returns a blob Object URL for the caller to `window.open`/render;
 * revoke it when done.
 */
export async function openReceipt(path: string): Promise<string | null> {
  if (isDesktop()) {
    const found = await appDocumentExists(path);
    if (!found) throw new Error("Receipt not found on this device");
    const abs = await appDocumentAbsPath(path);
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(abs);
    return null; // opened natively — nothing for the caller to display
  }

  const row = await db.receipts.get(path);
  if (!row) throw new Error("Receipt not found on this device");
  return URL.createObjectURL(row.blob);
}

/** @deprecated use `openReceipt`, which now handles both platforms. */
export const receiptUrl = openReceipt;
