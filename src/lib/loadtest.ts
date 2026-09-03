import {
  db,
  newId,
  resyncCounters,
  type BillRow,
  type ExpenseRow,
  type SnackSaleRow,
  type TurfBookingRow,
} from "./localdb";
import { rowsForYear, YEAR_TABLES, type YearTable } from "./years";
import { lastMonthKeys, monthKey, periodStats, profitAndLoss, type Sources } from "./analytics";
import type { Bill } from "./biz";
import type { ExpenseV2, SnackSale, TurfBooking } from "./ops";
import { buildReportPdf, type ReportTable } from "./report-pdf";
import { rupees } from "./money";

/**
 * Five-year load test.
 *
 * Generates a realistic multi-year ledger (default ~40 records/day, i.e.
 * ~73,000 rows over five years) straight into IndexedDB, then times the
 * paths that actually hurt at that scale: the per-year indexed reads the
 * screens do, the analytics aggregation behind Dashboard/Reports, the
 * jsPDF statement build, and the ExcelJS workbook build.
 *
 * Every generated row is tagged with an "LT-" document-number prefix (ids
 * start with "lt-") so `clearLoadTestData()` removes exactly this data and
 * never touches real records — same containment trick as verificationSeed.
 */

export const LT_PREFIX = "LT-";
const LT_ID = "lt-";
export const LOAD_TEST_YEARS = 5;

/** Records per day, split across the four transactional tables. */
export type LoadTestMix = {
  bookings: number;
  sales: number;
  bills: number;
  expenses: number;
};

export const MIX_MEDIUM: LoadTestMix = { bookings: 14, sales: 18, bills: 6, expenses: 2 };

/** A quieter, "normal" day — 10 bookings plus a modest amount of snacks,
 * bills and expenses. Lighter than MIX_MEDIUM, still five full years. */
export const MIX_LIGHT: LoadTestMix = { bookings: 10, sales: 8, bills: 4, expenses: 2 };

export const LOAD_TEST_MIXES: Record<"light" | "medium", { label: string; mix: LoadTestMix }> = {
  light: { label: "Light (10 bookings/day)", mix: MIX_LIGHT },
  medium: { label: "Medium (14 bookings/day)", mix: MIX_MEDIUM },
};

/** Deterministic PRNG so two runs produce the same dataset (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  "Arjun",
  "Meera",
  "Rahul",
  "Priya",
  "Vikram",
  "Sneha",
  "Karthik",
  "Divya",
  "Imran",
  "Anita",
  "Rohit",
  "Fatima",
  "Suresh",
  "Nisha",
  "Manoj",
  "Kavya",
];
const SLOTS = ["Morning", "Evening", "Night", "Prime"];
const MODES = ["Cash", "UPI", "Card"];
const SNACKS = [
  { item_name: "Tea", unit_price: 15, cost_price: 6 },
  { item_name: "Coffee", unit_price: 25, cost_price: 10 },
  { item_name: "Samosa", unit_price: 20, cost_price: 9 },
  { item_name: "Sandwich", unit_price: 60, cost_price: 30 },
  { item_name: "Cold Drink", unit_price: 40, cost_price: 26 },
  { item_name: "Energy Drink", unit_price: 90, cost_price: 62 },
  { item_name: "Water Bottle", unit_price: 20, cost_price: 10 },
  { item_name: "Chips", unit_price: 30, cost_price: 20 },
];
const EXPENSE_CATS = ["Maintenance", "Electricity", "Staff", "Supplies", "Rent"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export type SeedProgress = { done: number; total: number; label: string };

export function loadTestYears(endYear = new Date().getFullYear(), count = LOAD_TEST_YEARS) {
  return Array.from({ length: count }, (_, i) => endYear - (count - 1) + i);
}

export function estimatedRows(mix: LoadTestMix = MIX_MEDIUM, years = LOAD_TEST_YEARS) {
  const perDay = mix.bookings + mix.sales + mix.bills + mix.expenses;
  return perDay * 365 * years;
}

/** Writes the whole dataset, one month per transaction chunk. */
export async function seedLoadTestData(
  opts: { mix?: LoadTestMix; years?: number[] } = {},
  onProgress?: (p: SeedProgress) => void,
): Promise<{ rows: number; ms: number }> {
  const mix = opts.mix ?? MIX_MEDIUM;
  const years = opts.years ?? loadTestYears();
  const started = performance.now();
  const rand = rng(20260903);
  let written = 0;
  let seq = 0;
  const totalMonths = years.length * 12;
  let monthsDone = 0;

  for (const y of years) {
    for (let m = 1; m <= 12; m++) {
      const bookings: TurfBookingRow[] = [];
      const sales: SnackSaleRow[] = [];
      const bills: BillRow[] = [];
      const expenses: ExpenseRow[] = [];
      const dim = daysInMonth(y, m);

      for (let d = 1; d <= dim; d++) {
        const date = iso(y, m, d);
        const busy = 0.75 + rand() * 0.6; // seasonal-ish daily variation

        for (let i = 0; i < Math.round(mix.bookings * busy); i++) {
          seq += 1;
          const hours = 1 + Math.floor(rand() * 3);
          const rate = 600 + Math.floor(rand() * 5) * 100;
          const total = hours * rate;
          const paidFull = rand() > 0.25;
          bookings.push({
            id: `${LT_ID}${newId()}`,
            booking_no: `${LT_PREFIX}INV-${seq}`,
            booking_date: date,
            customer_name: NAMES[Math.floor(rand() * NAMES.length)] ?? "Guest",
            phone: `9${String(100000000 + Math.floor(rand() * 899999999))}`,
            slot_name: SLOTS[Math.floor(rand() * SLOTS.length)] ?? "Evening",
            hours,
            rate_per_hour: rate,
            total_amount: total,
            advance_paid: paidFull ? total : Math.round(total * 0.5),
            payment_mode: MODES[Math.floor(rand() * MODES.length)] ?? "Cash",
            status: rand() > 0.03 ? "confirmed" : "cancelled",
            discount: 0,
            notes: null,
            start_time: "18:00",
            end_time: "19:00",
            courts: 1,
            snacks: [],
            snacks_total: 0,
            turf_amount: total,
            created_at: `${date}T12:00:00.000Z`,
            merged_into_bill_id: null,
          });
        }

        for (let i = 0; i < Math.round(mix.sales * busy); i++) {
          seq += 1;
          const lines = 1 + Math.floor(rand() * 3);
          const items = Array.from({ length: lines }, () => {
            const s = SNACKS[Math.floor(rand() * SNACKS.length)] ?? SNACKS[0]!;
            const qty = 1 + Math.floor(rand() * 4);
            return { ...s, qty, amount: qty * s.unit_price };
          });
          const total = items.reduce((n, it) => n + it.amount, 0);
          const cost = items.reduce((n, it) => n + it.qty * it.cost_price, 0);
          sales.push({
            id: `${LT_ID}${newId()}`,
            bill_no: `${LT_PREFIX}SB-${seq}`,
            sale_date: date,
            customer_name: NAMES[Math.floor(rand() * NAMES.length)] ?? null,
            items,
            total,
            profit: total - cost,
            payment_mode: MODES[Math.floor(rand() * MODES.length)] ?? "Cash",
            notes: null,
            booking_id: null,
            booking_no: null,
            created_at: `${date}T12:30:00.000Z`,
            merged_into_bill_id: null,
          });
        }

        for (let i = 0; i < Math.round(mix.bills * busy); i++) {
          seq += 1;
          const subtotal = 200 + Math.floor(rand() * 40) * 50;
          const discount = rand() > 0.85 ? 50 : 0;
          const total = subtotal - discount;
          const paid = rand() > 0.2 ? total : Math.round(total * 0.4);
          bills.push({
            id: `${LT_ID}${newId()}`,
            invoice_no: `${LT_PREFIX}INV-${seq}`,
            customer_name: NAMES[Math.floor(rand() * NAMES.length)] ?? "Guest",
            customer_phone: null,
            items: [{ item_name: "Turf + snacks", qty: 1, unit_price: total, amount: total }],
            subtotal,
            discount,
            total,
            amount_paid: paid,
            status: paid >= total ? "paid" : "partial",
            payment_mode: MODES[Math.floor(rand() * MODES.length)] ?? "Cash",
            // Bills store a full timestamp (see analytics.ts IST note).
            bill_date: `${date}T09:00:00.000Z`,
            created_at: `${date}T09:00:00.000Z`,
          });
        }

        for (let i = 0; i < Math.round(mix.expenses * busy); i++) {
          seq += 1;
          expenses.push({
            id: `${LT_ID}${newId()}`,
            expense_no: `${LT_PREFIX}TX-${seq}`,
            business: rand() > 0.5 ? "Turf" : "Snacks",
            category: EXPENSE_CATS[Math.floor(rand() * EXPENSE_CATS.length)] ?? "Supplies",
            description: "Load test expense",
            note: null,
            amount: 100 + Math.floor(rand() * 60) * 25,
            spent_at: date,
            receipt_path: null,
            created_at: `${date}T20:00:00.000Z`,
          });
        }
      }

      await db.transaction(
        "rw",
        db.turf_bookings,
        db.snack_sales,
        db.bills,
        db.expenses,
        async () => {
          await db.turf_bookings.bulkAdd(bookings);
          await db.snack_sales.bulkAdd(sales);
          await db.bills.bulkAdd(bills);
          await db.expenses.bulkAdd(expenses);
        },
      );

      written += bookings.length + sales.length + bills.length + expenses.length;
      monthsDone += 1;
      onProgress?.({
        done: monthsDone,
        total: totalMonths,
        label: `Seeding ${y}-${pad(m)} — ${written.toLocaleString("en-IN")} rows`,
      });
      // Yield to the UI thread between months.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await resyncCounters();
  return { rows: written, ms: performance.now() - started };
}

/** Removes only the generated rows (id prefix "lt-"). */
export async function clearLoadTestData(): Promise<number> {
  const isLt = (id: unknown) => String(id ?? "").startsWith(LT_ID);
  let removed = 0;
  removed += await db.turf_bookings.filter((r) => isLt(r.id)).delete();
  removed += await db.snack_sales.filter((r) => isLt(r.id)).delete();
  removed += await db.bills.filter((r) => isLt(r.id)).delete();
  removed += await db.expenses.filter((r) => isLt(r.id)).delete();
  await resyncCounters();
  return removed;
}

/** How many generated rows are currently in the database. */
export async function countLoadTestRows(): Promise<number> {
  const isLt = (id: unknown) => String(id ?? "").startsWith(LT_ID);
  const counts = await Promise.all([
    db.turf_bookings.filter((r) => isLt(r.id)).count(),
    db.snack_sales.filter((r) => isLt(r.id)).count(),
    db.bills.filter((r) => isLt(r.id)).count(),
    db.expenses.filter((r) => isLt(r.id)).count(),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ */
/* Benchmark                                                           */
/* ------------------------------------------------------------------ */

export type YearResult = {
  year: number;
  rows: number;
  readMs: number;
  analyticsMs: number;
  pdfMs: number;
  pdfKb: number;
  excelMs: number;
  excelKb: number;
  revenue: number;
  profit: number;
};

export type BenchmarkResult = {
  ranAt: string;
  totalRows: number;
  totalMs: number;
  years: YearResult[];
  allYears: { readMs: number; analyticsMs: number; pdfMs: number; pdfKb: number; rows: number };
};

const time = async <T>(fn: () => Promise<T> | T): Promise<[T, number]> => {
  const t0 = performance.now();
  const value = await fn();
  return [value, performance.now() - t0];
};

async function readYear(year: number) {
  const [bookings, sales, bills, expenses] = await Promise.all([
    rowsForYear<TurfBooking>("turf_bookings" as YearTable, year),
    rowsForYear<SnackSale>("snack_sales" as YearTable, year),
    rowsForYear<Bill>("bills" as YearTable, year),
    rowsForYear<ExpenseV2>("expenses" as YearTable, year),
  ]);
  return { bills, bookings, sales, expenses, tabEntries: [] } as Sources;
}

function monthsOf(year: number) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
}

/** The statement PDF the app produces, built over a whole year of data. */
function yearPdfDoc(year: number, src: Sources) {
  const months = monthsOf(year);
  const pnl = profitAndLoss(src, months);
  const summary: ReportTable = {
    title: `Month-by-month ${year}`,
    columns: ["Month", "Turf", "Snacks", "Bills", "Expenses", "Profit"],
    align: ["left", "right", "right", "right", "right", "right"],
    rows: pnl.map((r) => ({
      cells: [
        r.month,
        String(rupees(r.Turf)),
        String(rupees(r.Snacks)),
        String(rupees(r.Bills)),
        String(rupees(r.Expenses)),
        String(rupees(r.Profit)),
      ],
      negative: r.Profit < 0,
    })),
  };
  const bookings: ReportTable = {
    title: "Turf bookings (sample of 400)",
    columns: ["Date", "Booking", "Customer", "Slot", "Total"],
    align: ["left", "left", "left", "left", "right"],
    rows: src.bookings.slice(0, 400).map((b) => ({
      cells: [
        b.booking_date,
        b.booking_no,
        b.customer_name,
        b.slot_name,
        String(rupees(b.total_amount)),
      ],
    })),
  };
  return {
    title: `Load test statement ${year}`,
    subtitle: `${src.bills.length + src.bookings.length + src.sales.length + src.expenses.length} records`,
    tables: [summary, bookings],
    fileName: `load-test-${year}`,
  };
}

async function excelBytes(year: number, src: Sources) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const add = (name: string, rows: Record<string, string | number>[]) => {
    const ws = wb.addWorksheet(name);
    const keys = Object.keys(rows[0] ?? { Info: "" });
    ws.columns = keys.map((k) => ({ header: k, key: k, width: 18 }));
    ws.addRows(rows);
  };
  add(
    "Bookings",
    src.bookings.map((b) => ({
      Date: b.booking_date,
      No: b.booking_no,
      Customer: b.customer_name,
      Total: rupees(b.total_amount),
      Paid: rupees(b.advance_paid),
    })),
  );
  add(
    "Snack sales",
    src.sales.map((s) => ({
      Date: s.sale_date,
      No: s.bill_no,
      Total: rupees(s.total),
      Profit: rupees(s.profit),
    })),
  );
  add(
    "Bills",
    src.bills.map((b) => ({
      Date: monthKey(b.bill_date),
      No: b.invoice_no,
      Total: rupees(b.total),
      Paid: rupees(b.amount_paid),
    })),
  );
  add(
    "Expenses",
    src.expenses.map((e) => ({
      Date: e.spent_at,
      Category: e.category,
      Amount: rupees(e.amount),
    })),
  );
  const buf = await wb.xlsx.writeBuffer();
  return (buf as ArrayBuffer).byteLength;
}

export async function runLoadTestBenchmark(
  years = loadTestYears(),
  onProgress?: (p: SeedProgress) => void,
): Promise<BenchmarkResult> {
  const started = performance.now();
  const results: YearResult[] = [];
  const combined: Sources = { bills: [], bookings: [], sales: [], expenses: [], tabEntries: [] };
  let combinedReadMs = 0;

  for (const [i, year] of years.entries()) {
    onProgress?.({ done: i, total: years.length + 1, label: `Measuring ${year}…` });
    const [src, readMs] = await time(() => readYear(year));
    combinedReadMs += readMs;
    combined.bills.push(...src.bills);
    combined.bookings.push(...src.bookings);
    combined.sales.push(...src.sales);
    combined.expenses.push(...src.expenses);

    const months = monthsOf(year);
    const [stats, analyticsMs] = await time(() => {
      const perMonth = months.map((k) => periodStats(src, (isoDate) => monthKey(isoDate) === k));
      profitAndLoss(src, lastMonthKeys(months[11]!, 12));
      return perMonth.reduce(
        (acc, s) => ({ revenue: acc.revenue + s.revenue, profit: acc.profit + s.profit }),
        { revenue: 0, profit: 0 },
      );
    });

    const [pdfBytes, pdfMs] = await time(() => {
      const pdf = buildReportPdf(yearPdfDoc(year, src));
      return (pdf.output("arraybuffer") as ArrayBuffer).byteLength;
    });
    const [excelSize, excelMs] = await time(() => excelBytes(year, src));

    results.push({
      year,
      rows: src.bills.length + src.bookings.length + src.sales.length + src.expenses.length,
      readMs,
      analyticsMs,
      pdfMs,
      pdfKb: Math.round(pdfBytes / 1024),
      excelMs,
      excelKb: Math.round(excelSize / 1024),
      revenue: stats.revenue,
      profit: stats.profit,
    });
    await new Promise((r) => setTimeout(r, 0));
  }

  onProgress?.({ done: years.length, total: years.length + 1, label: "Measuring all 5 years…" });
  const allMonths = years.flatMap(monthsOf);
  const [, allAnalyticsMs] = await time(() => {
    profitAndLoss(combined, allMonths);
    periodStats(combined, () => true);
  });
  const [allPdfBytes, allPdfMs] = await time(() => {
    const pnl = profitAndLoss(combined, allMonths);
    const pdf = buildReportPdf({
      title: `Load test statement — ${years[0]}–${years[years.length - 1]}`,
      subtitle: `${allMonths.length} months, all business lines`,
      tables: [
        {
          title: "Month-by-month (5 years)",
          columns: ["Month", "Turf", "Snacks", "Bills", "Expenses", "Profit"],
          align: ["left", "right", "right", "right", "right", "right"],
          rows: pnl.map((r) => ({
            cells: [
              r.month,
              String(rupees(r.Turf)),
              String(rupees(r.Snacks)),
              String(rupees(r.Bills)),
              String(rupees(r.Expenses)),
              String(rupees(r.Profit)),
            ],
            negative: r.Profit < 0,
          })),
        },
      ],
      fileName: "load-test-5y",
    });
    return (pdf.output("arraybuffer") as ArrayBuffer).byteLength;
  });

  return {
    ranAt: new Date().toISOString(),
    totalRows: results.reduce((n, r) => n + r.rows, 0),
    totalMs: performance.now() - started,
    years: results,
    allYears: {
      readMs: combinedReadMs,
      analyticsMs: allAnalyticsMs,
      pdfMs: allPdfMs,
      pdfKb: Math.round(allPdfBytes / 1024),
      rows: combined.bills.length + combined.bookings.length + combined.sales.length + combined.expenses.length,
    },
  };
}

/** Turns a finished run into the app's own statement-PDF shape. */
export function benchmarkPdfDoc(r: BenchmarkResult) {
  const ms = (n: number) => `${n.toFixed(0)} ms`;
  return {
    title: "5-year load test results",
    subtitle: `${r.totalRows.toLocaleString("en-IN")} records • run ${new Date(r.ranAt).toLocaleString("en-IN")}`,
    fileName: "load-test-results",
    tables: [
      {
        title: "Per year",
        columns: ["Year", "Rows", "Read", "Analytics", "PDF", "Excel"],
        align: ["left", "right", "right", "right", "right", "right"] as (typeof ALIGN)[number][],
        rows: r.years.map((y) => ({
          cells: [
            String(y.year),
            y.rows.toLocaleString("en-IN"),
            ms(y.readMs),
            ms(y.analyticsMs),
            `${ms(y.pdfMs)} / ${y.pdfKb} KB`,
            `${ms(y.excelMs)} / ${y.excelKb} KB`,
          ],
        })),
      },
      {
        title: "All five years at once",
        columns: ["Metric", "Value"],
        align: ["left", "right"] as (typeof ALIGN)[number][],
        rows: [
          { cells: ["Rows loaded", r.allYears.rows.toLocaleString("en-IN")] },
          { cells: ["Indexed read (total)", ms(r.allYears.readMs)] },
          { cells: ["Analytics over 60 months", ms(r.allYears.analyticsMs)] },
          { cells: ["PDF build", `${ms(r.allYears.pdfMs)} / ${r.allYears.pdfKb} KB`] },
          { cells: ["Whole run", `${(r.totalMs / 1000).toFixed(1)} s`], strong: true },
        ],
      },
    ],
  };
}

const ALIGN = ["left", "right"] as const;

export const tableNames = Object.keys(YEAR_TABLES) as YearTable[];
