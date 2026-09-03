import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  CheckCircle2,
  FileDown,
  FileText,
  Percent,
  Receipt,
  TicketPercent,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDMY, money, whatsappUrl } from "@/lib/biz";
import { exportToExcel, exportWorkbook } from "@/lib/xlsx";
import { buildDashboardSheet } from "@/lib/dashboard-xlsx";
import {
  downloadReportPdf,
  reportPdfMoney,
  shareReportPdf,
  type ReportPdfDoc,
} from "@/lib/report-pdf";
import { readPrintSettings } from "@/lib/print";
import { useExpensesV2, useSnackSales, useTurfBookings, useUpdateTurfBooking } from "@/lib/ops";
import { customerLifetimeStats, useBills, useCustomers } from "@/lib/data";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  expenseByCategory,
  isFinancialBooking,
  lastMonthKeys,
  monthKey,
  monthLabel,
  paymentSplit,
  pctChange,
  prevMonthKey,
  profitAndLoss,
  statsForMonth,
  taxReport,
  type Sources,
} from "@/lib/analytics";
import { activeTaxes, readAppSettings } from "@/lib/settings";
import { compareBy, sortSuffix, useSortState, type SortOption } from "@/lib/sort";
import { DeltaStat } from "./DeltaStat";
import { HeroStat, MiniStat } from "./HeroStat";
import { PaymentSplitCard } from "./PaymentSplitCard";
import { SectionHeading } from "./SectionHeading";
import { SortMenu } from "./SortMenu";

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type ItemSortField = "qty" | "revenue" | "profit" | "name";

const ITEM_SORT_OPTIONS: SortOption<ItemSortField>[] = [
  { value: "revenue", label: "Revenue", defaultDir: "desc" },
  { value: "qty", label: "Qty", defaultDir: "desc" },
  { value: "profit", label: "Profit", defaultDir: "desc" },
  { value: "name", label: "Name", defaultDir: "asc" },
];

type TurfDuesSortField = "due" | "name" | "date";

const TURF_DUES_SORT_OPTIONS: SortOption<TurfDuesSortField>[] = [
  { value: "due", label: "Due amount", defaultDir: "desc" },
  { value: "name", label: "Customer", defaultDir: "asc" },
  { value: "date", label: "Booking date", defaultDir: "desc" },
];

/** Quick-jump targets shown as chips under the month picker. */
function quickMonthTargets() {
  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = prevMonthKey(thisMonth);
  const threeAgo = monthKey(new Date(now.getFullYear(), now.getMonth() - 3, 1));
  const lastYear = monthKey(new Date(now.getFullYear() - 1, now.getMonth(), 1));
  return [
    { label: "This month", key: thisMonth },
    { label: "Last month", key: lastMonth },
    { label: "3 months ago", key: threeAgo },
    { label: "Same month last year", key: lastYear },
  ];
}

export function ReportsTab() {
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const { data: expenses = [] } = useExpensesV2();
  const { data: customers = [] } = useCustomers();
  const updateBooking = useUpdateTurfBooking();
  const isMobile = useIsMobile();

  const [month, setMonth] = useState(() => monthKey(new Date()));
  const monthChips = useMemo(quickMonthTargets, []);
  const itemSort = useSortState<ItemSortField>("reports-items", ITEM_SORT_OPTIONS, {
    field: "revenue",
    dir: "desc",
  });

  const inMonth = useMemo(() => {
    const b = bookings.filter((x) => monthKey(x.booking_date) === month && isFinancialBooking(x));
    const s = sales.filter((x) => monthKey(x.sale_date) === month);
    const e = expenses.filter((x) => monthKey(x.spent_at) === month);
    return { b, s, e };
  }, [bookings, sales, expenses, month]);

  // Single shared source of truth for revenue/profit math (also used by the
  // trend chart and Excel export below), so the KPI cards can't drift out of
  // sync with them. This previously duplicated the calculation by hand from
  // just turf bookings + snack sales, which silently excluded any revenue
  // that had been merged into a Bill (see MergeBillDialog) — so "Net profit"
  // on screen could under-report versus the trend chart/export right below it.
  const src = useMemo<Sources>(
    () => ({ bills, bookings, sales, expenses }),
    [bills, bookings, sales, expenses],
  );
  const cur = useMemo(() => statsForMonth(src, month), [src, month]);

  const kpis = useMemo(() => {
    // "Outstanding turf dues" is intentionally turf-bookings-only (not bills),
    // so it's kept as its own calculation rather than cur.dues.
    const dues = inMonth.b.reduce(
      (n, x) => n + Math.max(0, (Number(x.total_amount) || 0) - (Number(x.advance_paid) || 0)),
      0,
    );
    return {
      turf: cur.turfRevenue,
      snacks: cur.snacksRevenue,
      spend: cur.expenses,
      profit: cur.profit,
      dues,
      snackProfit: cur.snackProfit,
    };
  }, [inMonth, cur]);

  const itemRows = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
    for (const s of inMonth.s)
      for (const it of s.items ?? []) {
        const name = (it.item_name || "Item").trim();
        const prev = map.get(name) ?? { name, qty: 0, revenue: 0, profit: 0 };
        prev.qty += Number(it.qty) || 0;
        prev.revenue += Number(it.amount) || 0;
        prev.profit +=
          (Number(it.amount) || 0) - (Number(it.qty) || 0) * (Number(it.cost_price) || 0);
        map.set(name, prev);
      }
    return [...map.values()].sort((a, b) => {
      switch (itemSort.field) {
        case "qty":
          return compareBy(a.qty, b.qty, itemSort.dir);
        case "profit":
          return compareBy(a.profit, b.profit, itemSort.dir);
        case "name":
          return compareBy(a.name.toLowerCase(), b.name.toLowerCase(), itemSort.dir);
        case "revenue":
        default:
          return compareBy(a.revenue, b.revenue, itemSort.dir);
      }
    });
  }, [inMonth, itemSort.field, itemSort.dir]);

  const pieData = useMemo(
    () => itemRows.slice(0, 5).map((r) => ({ name: r.name, value: r.revenue })),
    [itemRows],
  );

  const dues = useMemo(
    () =>
      bookings.filter(
        (b) => isFinancialBooking(b) && Number(b.total_amount) - Number(b.advance_paid) > 0,
      ),
    [bookings],
  );

  const turfDuesSort = useSortState<TurfDuesSortField>(
    "reports-turf-dues",
    TURF_DUES_SORT_OPTIONS,
    { field: "due", dir: "desc" },
  );
  const sortedDues = useMemo(
    () =>
      [...dues].sort((a, b) => {
        switch (turfDuesSort.field) {
          case "name":
            return compareBy(
              a.customer_name.toLowerCase(),
              b.customer_name.toLowerCase(),
              turfDuesSort.dir,
            );
          case "date":
            return compareBy(a.booking_date, b.booking_date, turfDuesSort.dir);
          case "due":
          default:
            return compareBy(
              Number(a.total_amount) - Number(a.advance_paid),
              Number(b.total_amount) - Number(b.advance_paid),
              turfDuesSort.dir,
            );
        }
      }),
    [dues, turfDuesSort.field, turfDuesSort.dir],
  );

  const supporting = [
    { label: "Turf revenue", value: kpis.turf },
    { label: "Snacks revenue", value: kpis.snacks },
    { label: "Total expenses", value: kpis.spend },
    { label: "Outstanding turf dues", value: kpis.dues },
    { label: "Snacks gross profit", value: kpis.snackProfit },
  ];

  const prev = useMemo(() => statsForMonth(src, prevMonthKey(month)), [src, month]);
  const pnl = useMemo(() => profitAndLoss(src, lastMonthKeys(month, 6)), [src, month]);

  const appSettings = useMemo(() => readAppSettings(), []);
  const taxesActive = useMemo(() => activeTaxes(appSettings), [appSettings]);
  const taxRows = useMemo(
    () => (taxesActive.length > 0 ? taxReport(src, lastMonthKeys(month, 6), appSettings) : []),
    [src, month, taxesActive.length, appSettings],
  );
  const curTaxRow = taxRows[taxRows.length - 1] ?? null;

  const split = useMemo(() => paymentSplit(src, (iso) => monthKey(iso) === month), [src, month]);
  const categories = useMemo(
    () => expenseByCategory(src, (iso) => monthKey(iso) === month),
    [src, month],
  );

  // Chart data for "Last 6 months": derived from the same `pnl` rows used by
  // the table above (single source of truth), with a profit-margin %
  // computed alongside so it can ride a secondary axis over the revenue bars.
  const revenueTrend = useMemo(
    () =>
      pnl.map((r) => ({
        month: r.month,
        Turf: r.Turf,
        Snacks: r.Snacks,
        Bills: r.Bills,
        Margin: r.Revenue > 0 ? (r.Profit / r.Revenue) * 100 : 0,
      })),
    [pnl],
  );
  const expenseTrend = useMemo(
    () => pnl.map((r) => ({ month: r.month, Expenses: r.Expenses })),
    [pnl],
  );

  const insights = useMemo(() => {
    const collectionRate = cur.revenue > 0 ? (cur.collected / cur.revenue) * 100 : 0;
    const topExpense = categories[0] ?? null;
    const avgBookingValue = inMonth.b.length > 0 ? kpis.turf / inMonth.b.length : 0;
    return { collectionRate, topExpense, avgBookingValue };
  }, [cur, categories, inMonth.b.length, kpis.turf]);

  const compareCards = [
    {
      label: "Revenue",
      value: cur.revenue,
      previous: prev.revenue,
      change: pctChange(cur.revenue, prev.revenue),
      invert: false,
    },
    {
      label: "Tax",
      value: cur.tax,
      previous: prev.tax,
      change: pctChange(cur.tax, prev.tax),
      invert: false,
    },
    {
      label: "Collected",
      value: cur.collected,
      previous: prev.collected,
      change: pctChange(cur.collected, prev.collected),
      invert: false,
    },
    {
      label: "Expenses",
      value: cur.expenses,
      previous: prev.expenses,
      change: pctChange(cur.expenses, prev.expenses),
      invert: true,
    },
    {
      label: "Profit",
      value: cur.profit,
      previous: prev.profit,
      change: pctChange(cur.profit, prev.profit),
      invert: false,
    },
  ];

  const exportReport = () => {
    const printSettings = readPrintSettings();
    const prevCollectionRate = prev.revenue > 0 ? (prev.collected / prev.revenue) * 100 : 0;
    const dashboardKpis = [
      {
        label: "Revenue",
        value: cur.revenue,
        previous: prev.revenue,
        change: pctChange(cur.revenue, prev.revenue),
        invert: false,
      },
      {
        label: "Profit",
        value: cur.profit,
        previous: prev.profit,
        change: pctChange(cur.profit, prev.profit),
        invert: false,
      },
      {
        label: "Collected",
        value: cur.collected,
        previous: prev.collected,
        change: pctChange(cur.collected, prev.collected),
        invert: false,
      },
      {
        label: "Expenses",
        value: cur.expenses,
        previous: prev.expenses,
        change: pctChange(cur.expenses, prev.expenses),
        invert: true,
      },
      {
        label: "Dues",
        value: cur.dues,
        previous: prev.dues,
        change: pctChange(cur.dues, prev.dues),
        invert: true,
      },
      {
        label: "Collection rate",
        value: insights.collectionRate,
        previous: prevCollectionRate,
        change: pctChange(insights.collectionRate, prevCollectionRate),
        invert: false,
        isCurrency: false,
      },
    ];
    exportWorkbook(
      [
        {
          name: "Dashboard",
          build: (ws) =>
            buildDashboardSheet(ws, {
              shopName: printSettings.shopName || "Business",
              periodLabel: monthLabel(month),
              currencySymbol: printSettings.currencySymbol,
              kpis: dashboardKpis,
              collectionRatePct: insights.collectionRate,
              topExpense: insights.topExpense,
              avgBookingValue: insights.avgBookingValue,
              pnl: pnl.map((r) => ({
                month: r.month,
                Revenue: r.Revenue,
                Expenses: r.Expenses,
                Profit: r.Profit,
              })),
            }),
        },
        {
          name: "Summary",
          rows: compareCards.map((c) => ({
            Metric: c.label,
            [monthLabel(month)]: c.value,
            [monthLabel(prevMonthKey(month))]: c.previous,
            "Change %": c.change === null ? "n/a" : Number(c.change.toFixed(1)),
          })),
        },
        {
          name: "Profit and loss",
          rows: pnl.map((r) => ({
            Month: r.month,
            Turf: r.Turf,
            Snacks: r.Snacks,
            Bills: r.Bills,
            Revenue: r.Revenue,
            Expenses: r.Expenses,
            Profit: r.Profit,
            Collected: r.Collected,
            Dues: r.Dues,
          })),
        },
        {
          name: "Payment modes",
          rows: split.map((s) => ({ Mode: s.name, Amount: s.value })),
        },
        {
          name: "Expenses",
          rows: categories.map((c) => ({ Category: c.name, Amount: c.value })),
        },
        ...(taxRows.length > 0
          ? [
              {
                name: "Tax",
                rows: taxRows.map((r) => ({
                  Month: r.month,
                  "Taxable value": r.taxableValue,
                  ...Object.fromEntries(r.lines.map((l) => [l.label, l.value])),
                  "Total tax": r.totalTax,
                  "Gross value": r.grossValue,
                })),
              },
            ]
          : []),
        {
          name: "Items",
          rows: itemRows.map((r) => ({
            Item: r.name,
            Qty: r.qty,
            Revenue: r.revenue,
            Profit: r.profit,
          })),
        },
        // Raw record-level sheets — every row currently loaded (the app's
        // active year window, not just the selected report month), so an
        // owner or accountant can filter/pivot on real transactions instead
        // of only the aggregated tables above.
        {
          name: "Turf bookings",
          autofilter: true,
          moneyColumns: ["Rate/hr", "Amount", "Advance paid", "Balance due"],
          rows: bookings.map((b) => ({
            "Booking ID": b.booking_no,
            Date: formatDMY(b.booking_date),
            Customer: b.customer_name,
            Phone: b.phone ?? "",
            Slot: b.slot_name,
            Hours: b.hours,
            "Rate/hr": b.rate_per_hour,
            // A merged booking's revenue is already counted on its Bill, so
            // the amount here is zeroed (matching the same convention the
            // Turf tab's own export uses) — otherwise a plain SUM() over
            // this column would double-count that money.
            Amount: b.merged_into_bill_id ? 0 : b.total_amount,
            "Advance paid": b.merged_into_bill_id ? 0 : b.advance_paid,
            "Balance due": b.merged_into_bill_id
              ? 0
              : Math.max(0, Number(b.total_amount) - Number(b.advance_paid)),
            "Payment mode": b.payment_mode,
            Status: b.status,
            "Merged into bill": b.merged_into_bill_id ? "Yes — see Bills" : "No",
          })),
        },
        {
          name: "Snack sales",
          autofilter: true,
          moneyColumns: ["Unit price", "Amount", "Profit"],
          rows: sales.flatMap((s) =>
            (s.items ?? []).map((it) => ({
              "Bill No": s.bill_no,
              Date: formatDMY(s.sale_date),
              Customer: s.customer_name ?? "",
              Item: it.item_name,
              Qty: it.qty,
              "Unit price": it.unit_price,
              Amount: it.amount,
              Profit: it.amount - it.qty * it.cost_price,
              "Payment mode": s.payment_mode,
            })),
          ),
        },
        {
          name: "Expenses (raw)",
          autofilter: true,
          moneyColumns: ["Amount"],
          rows: expenses.map((e) => ({
            "Expense ID": e.expense_no ?? "",
            Date: formatDMY(e.spent_at),
            Business: e.business,
            Category: e.category,
            Description: e.description ?? "",
            Amount: e.amount,
            Notes: e.note ?? "",
          })),
        },
        {
          name: "Customers",
          autofilter: true,
          moneyColumns: [
            "Lifetime spend",
            "Bills spend",
            "Turf spend",
            "Snacks spend",
            "Avg. booking value",
            "Outstanding turf dues",
          ],
          rows: customerLifetimeStats(customers, { bills, bookings, sales })
            .sort((a, b) => b.totalSpend - a.totalSpend)
            .map((c) => ({
              Name: c.name,
              Phone: c.phone ?? "",
              "Turf bookings": c.bookingsCount,
              "Lifetime spend": c.totalSpend,
              "Bills spend": c.billsSpend,
              "Turf spend": c.turfSpend,
              "Snacks spend": c.snacksSpend,
              "Avg. booking value": c.avgBookingValue,
              "Outstanding turf dues": c.outstandingTurfDues,
              "First visit": c.firstActivity ? formatDMY(c.firstActivity) : "",
              "Last activity": c.lastActivity ? formatDMY(c.lastActivity) : "",
            })),
        },
      ],
      `report-${month}`,
    );
    toast.success("Report exported");
  };

  const buildStatementDoc = (): ReportPdfDoc => {
    const s = readPrintSettings();
    return {
      title: `Monthly statement — ${monthLabel(month)}`,
      subtitle: `${s.shopName || "Business"} · generated for ${monthLabel(month)}`,
      fileName: `statement-${month}`,
      tables: [
        {
          title: `${monthLabel(month)} vs ${monthLabel(prevMonthKey(month))}`,
          columns: ["Metric", monthLabel(month), monthLabel(prevMonthKey(month)), "Change"],
          rows: compareCards.map((c) => ({
            cells: [
              c.label,
              reportPdfMoney(c.value, s.currencySymbol),
              reportPdfMoney(c.previous, s.currencySymbol),
              c.change === null ? "n/a" : `${c.change > 0 ? "+" : ""}${c.change.toFixed(1)}%`,
            ],
            strong: c.label === "Profit",
            negative: c.label === "Profit" && c.value < 0,
          })),
        },
        {
          title: "Profit & loss — last 6 months",
          columns: ["Month", "Revenue", "Expenses", "Profit", "Collected"],
          rows: pnl.map((r) => ({
            cells: [
              r.month,
              reportPdfMoney(r.Revenue, s.currencySymbol),
              reportPdfMoney(r.Expenses, s.currencySymbol),
              reportPdfMoney(r.Profit, s.currencySymbol),
              reportPdfMoney(r.Collected, s.currencySymbol),
            ],
            negative: r.Profit < 0,
          })),
        },
        {
          title: "Payment modes",
          columns: ["Mode", "Amount"],
          rows: split.map((p) => ({ cells: [p.name, reportPdfMoney(p.value, s.currencySymbol)] })),
        },
        {
          title: "Expenses by category",
          columns: ["Category", "Amount"],
          rows: categories.map((c) => ({
            cells: [c.name, reportPdfMoney(c.value, s.currencySymbol)],
          })),
        },
        ...(taxRows.length > 0
          ? [
              {
                title: "GST / tax — last 6 months",
                columns: [
                  "Month",
                  "Taxable value",
                  ...(taxRows[0]?.lines.map((l) => l.label) ?? []),
                  "Total tax",
                ],
                rows: taxRows.map((r) => ({
                  cells: [
                    r.month,
                    reportPdfMoney(r.taxableValue, s.currencySymbol),
                    ...r.lines.map((l) => reportPdfMoney(l.value, s.currencySymbol)),
                    reportPdfMoney(r.totalTax, s.currencySymbol),
                  ],
                })),
              },
            ]
          : []),
      ],
    };
  };

  const exportPdf = () => {
    downloadReportPdf(buildStatementDoc()).then(
      () => toast.success("Statement saved"),
      (e) => toast.error(e instanceof Error ? e.message : "Could not save PDF"),
    );
  };

  const sharePdf = () => {
    const text = `${monthLabel(month)} statement: revenue ${money(cur.revenue)}, profit ${money(cur.profit)}.`;
    shareReportPdf(buildStatementDoc(), whatsappUrl(text)).then(
      (result) => {
        if (result !== "cancelled") toast.success("Statement ready to share");
      },
      (e) => toast.error(e instanceof Error ? e.message : "Could not share PDF"),
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="REPORTS" title="Reports" hint={monthLabel(month)} icon={FileText} />
      <Card className="frost">
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div>
            <Label className="stat-label text-muted-foreground">Month</Label>
            <Input
              className="h-11"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value || monthKey(new Date()))}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            {monthChips.map((c) => (
              <Button
                key={c.label}
                type="button"
                size="sm"
                variant={month === c.key ? "default" : "outline"}
                className="frost-soft lift h-8 rounded-full px-3 text-xs"
                onClick={() => setMonth(c.key)}
              >
                {c.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <HeroStat
          label="Net profit"
          value={money(kpis.profit)}
          hint={`${monthLabel(month)} · after all expenses`}
          tone={kpis.profit < 0 ? "bad" : "good"}
          footer={<DeltaStat change={pctChange(cur.profit, prev.profit)} />}
        />
        <HeroStat
          label="Total revenue"
          value={money(cur.revenue)}
          hint={`Collected ${money(cur.collected)}`}
          tone="primary"
          footer={<DeltaStat change={pctChange(cur.revenue, prev.revenue)} />}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {supporting.map((c) => (
          <MiniStat key={c.label} label={c.label} value={money(c.value)} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat
          label="Collection rate"
          value={`${insights.collectionRate.toFixed(0)}%`}
          hint="Collected vs revenue billed"
          icon={Percent}
        />
        <MiniStat
          label="Avg. booking value"
          value={money(insights.avgBookingValue)}
          hint={`${inMonth.b.length} turf booking${inMonth.b.length === 1 ? "" : "s"} this month`}
          icon={TicketPercent}
        />
        <Card className="frost">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-1">
              <p className="stat-label truncate text-muted-foreground">Top expense category</p>
              <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
            {insights.topExpense ? (
              <>
                <p className="stat-value mt-1 text-base leading-tight">
                  {insights.topExpense.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {money(insights.topExpense.value)} of {money(kpis.spend)}
                </p>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${kpis.spend > 0 ? Math.min(100, (insights.topExpense.value / kpis.spend) * 100) : 0}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <p className="stat-value mt-1 text-base leading-tight text-muted-foreground">
                No expenses yet
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="frost">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="page-title text-base">
            {monthLabel(month)} vs {monthLabel(prevMonthKey(month))}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={exportPdf}>
              <FileText className="h-4 w-4" /> PDF statement
            </Button>
            <Button size="sm" variant="outline" onClick={sharePdf}>
              <FileText className="h-4 w-4" /> Share
            </Button>
            <Button size="sm" variant="outline" onClick={exportReport}>
              <FileDown className="h-4 w-4" /> Export Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {compareCards.map((c) => (
            <div key={c.label} className="frost-soft lift rounded-lg border p-3">
              <p className="micro-label text-muted-foreground">{c.label}</p>
              <p className="stat-value mt-0.5 text-lg leading-tight">{money(c.value)}</p>
              <p className="text-[11px] text-muted-foreground">was {money(c.previous)}</p>
              <DeltaStat change={c.change} invert={c.invert} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="frost">
        <CardHeader className="pb-2">
          <CardTitle className="page-title text-base">Profit &amp; loss by month</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Month</th>
                <th className="py-2 text-right">Revenue</th>
                <th className="py-2 text-right">Expenses</th>
                <th className="py-2 text-right">Profit</th>
                <th className="py-2 text-right">Dues</th>
              </tr>
            </thead>
            <tbody>
              {pnl.map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="py-2">{r.month}</td>
                  <td className="py-2 text-right">{money(r.Revenue)}</td>
                  <td className="py-2 text-right">{money(r.Expenses)}</td>
                  <td
                    className={
                      r.Profit < 0
                        ? "py-2 text-right font-semibold text-destructive"
                        : "py-2 text-right font-semibold"
                    }
                  >
                    {money(r.Profit)}
                  </td>
                  <td className="py-2 text-right">{money(r.Dues)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <PaymentSplitCard data={split} subtitle={monthLabel(month)} />

      <Card className="frost">
        <CardHeader className="pb-2">
          <CardTitle className="page-title text-base">Revenue by source · last 6 months</CardTitle>
        </CardHeader>
        <CardContent className="h-64 px-2 md:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={revenueTrend}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis yAxisId="money" fontSize={11} width={44} />
              <YAxis
                yAxisId="pct"
                orientation="right"
                fontSize={11}
                width={40}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                formatter={(v: number, name: string) =>
                  name === "Margin" ? `${v.toFixed(1)}%` : money(v)
                }
              />
              <Legend />
              <Bar
                yAxisId="money"
                dataKey="Bills"
                name="Bills"
                stackId="rev"
                fill="var(--chart-4)"
                radius={0}
              />
              <Bar
                yAxisId="money"
                dataKey="Turf"
                name="Turf"
                stackId="rev"
                fill="var(--chart-1)"
                radius={0}
              />
              <Bar
                yAxisId="money"
                dataKey="Snacks"
                name="Snacks"
                stackId="rev"
                fill="var(--chart-2)"
                radius={4}
              />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="Margin"
                name="Profit margin"
                stroke="var(--chart-5)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="frost">
        <CardHeader className="pb-2">
          <CardTitle className="page-title text-base">Expenses · last 6 months</CardTitle>
        </CardHeader>
        <CardContent className="h-56 px-2 md:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={expenseTrend}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} width={44} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Bar dataKey="Expenses" fill="var(--chart-3)" radius={4} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {curTaxRow && (
        <Card className="frost">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base page-title">
              <Receipt className="h-4 w-4" />
              GST / tax — {monthLabel(month)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="frost-well rounded-lg border p-3">
                <p className="micro-label text-muted-foreground">Taxable value</p>
                <p className="stat-value text-lg">{money(curTaxRow.taxableValue)}</p>
              </div>
              {curTaxRow.lines.map((l) => (
                <div key={l.label} className="frost-well rounded-lg border p-3">
                  <p className="micro-label text-muted-foreground">{l.label}</p>
                  <p className="stat-value text-lg">{money(l.value)}</p>
                </div>
              ))}
              <div className="frost-well rounded-lg border p-3">
                <p className="micro-label text-muted-foreground">Total tax</p>
                <p className="stat-value text-lg">{money(curTaxRow.totalTax)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Applies today's tax settings across every month shown — it isn't a record of what each
              bill charged at the time. Full 6-month breakdown is in the Excel export and PDF
              statement.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="frost">
        <CardHeader className="pb-2">
          <CardTitle className="page-title text-base">Snack revenue share</CardTitle>
        </CardHeader>
        <CardContent className="h-64 px-2 md:h-80">
          {pieData.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No snack sales this month.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius="75%" label>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="frost">
        <CardHeader className="flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="page-title text-base">Item-wise sales</CardTitle>
          <div className="flex flex-wrap gap-2">
            <SortMenu
              options={ITEM_SORT_OPTIONS}
              field={itemSort.field}
              dir={itemSort.dir}
              onFieldChange={itemSort.setField}
              onToggleDir={itemSort.toggleDir}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                exportToExcel(
                  itemRows.map((r) => ({
                    Item: r.name,
                    Qty: r.qty,
                    Revenue: r.revenue,
                    Profit: r.profit,
                  })),
                  `items-${month}-${sortSuffix(itemSort.field, itemSort.dir)}`,
                  "Items",
                )
              }
            >
              <FileDown className="h-4 w-4" /> Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {itemRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No snack sales this month.</p>
          ) : isMobile ? (
            <div className="space-y-2">
              {itemRows.map((r) => (
                <div key={r.name} className="frost-soft lift rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="stat-value text-sm">{money(r.revenue)}</p>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Qty {r.qty}</span>
                    <span className={r.profit < 0 ? "font-medium text-destructive" : "font-medium"}>
                      Profit {money(r.profit)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2">Item</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Revenue</th>
                    <th className="py-2 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {itemRows.map((r) => (
                    <tr key={r.name} className="border-t">
                      <td className="py-2">{r.name}</td>
                      <td className="py-2 text-right">{r.qty}</td>
                      <td className="py-2 text-right">{money(r.revenue)}</td>
                      <td className="py-2 text-right">{money(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="frost">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="page-title text-base">Turf dues</CardTitle>
          {dues.length > 0 && (
            <SortMenu
              options={TURF_DUES_SORT_OPTIONS}
              field={turfDuesSort.field}
              dir={turfDuesSort.dir}
              onFieldChange={turfDuesSort.setField}
              onToggleDir={turfDuesSort.toggleDir}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {dues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending dues.</p>
          ) : (
            sortedDues.map((b) => (
              <div
                key={b.id}
                className="frost-soft lift flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
              >
                <div>
                  <p className="font-semibold">
                    {b.booking_no} · {b.customer_name}
                  </p>
                  <p className="text-muted-foreground">
                    Total {money(b.total_amount)}
                    {b.discount > 0 && <> · Offer -{money(b.discount)}</>} · Paid{" "}
                    {money(b.advance_paid)}
                  </p>
                  <p className="font-medium text-destructive">
                    Due {money(Number(b.total_amount) - Number(b.advance_paid))}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={updateBooking.isPending}
                  onClick={() =>
                    updateBooking.mutate(
                      {
                        id: b.id,
                        advance_paid: b.total_amount,
                        status: "Completed",
                      },
                      { onSuccess: () => toast.success("Marked as paid") },
                    )
                  }
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark paid
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
