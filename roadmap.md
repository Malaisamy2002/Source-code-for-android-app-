# Turf & Snacks App — Dashboard & Reports Roadmap

Source: `dashboard-reports-ideas.md` + `reports-card-improvements.md`, against the
`installer-builder-bot-main` codebase (`DashboardTab.tsx` 432 lines, `ReportsTab.tsx` 522 lines).

> Note: the app code has been imported into this project (Step 0 done).

---

## Done so far (already in the codebase)

**Dashboard**
- 6 today-cards + month-vs-last-month strip
- 14-day bar chart, 6-month profit line, payment split
- "Collect now" dues list with one-tap Cash/UPI collection (full settle only)

**Reports**
- Month picker, 6 KPI cards, month-vs-previous comparison
- P&L trend, payment split, expense categories, item-wise sales table
- 5-sheet Excel export (`exportWorkbook`)

**Supporting pieces already built (reusable, not yet wired into these screens)**
- `analytics.ts`, `taxBreakdown()`, `years.ts` / `ArchiveYearDialog` (multi-year data)
- `InvoiceBrandingCard` + `print.ts` (print/PDF path), `WhatsAppSummaryCard` (share path)
- `SnackStockCard`, `CustomerDirectoryCard`, `use-mobile.tsx`, shadcn `sidebar`/`skeleton`/`command`

---

## Still to do — step by step

### Step 0 — Import the codebase — DONE
The zip's `src/` (and config) is in this project; dependencies installed.

### Step 1 — Foundation: design system + hierarchy — DONE
1. [x] Frosted ice-blue tokens in `src/styles.css`: pale ice-blue paper bg, translucent
   `backdrop-blur` cards, one blue accent, semantic good/warn/bad. JetBrains Mono for
   labels, Inter Tight + `tabular-nums` for figures.
2. [x] Dashboard hero row: "Collected today" + "Pending dues" at ~34px; other four demoted to a strip.
3. [x] Reports hero row: Net profit + Total revenue span 2 cols; snack metrics demoted.
   Profit colour-coded with a trend arrow vs last month.
4. [x] One hue per business line (Turf / Snacks / Bills) tokens added; applied to dues badges.
   Charts still to adopt them in Step 4.


### Step 2 — Daily-use pain (small, high value)
5. Partial payment collection — inline amount field instead of forcing `amount_paid = row.total`.
6. Dues ageing — group by Today / This week / 30+ days overdue, overdue-first, per-row WhatsApp reminder.
7. Skeletons while loading + first-run empty states (today `[]` defaults show a misleading ₹0).
8. Quick-range chips (Today / 7d / 30d / This month / Last month / Last 3m / This year), shared
   between Dashboard and Reports, persisted to localStorage.

### Step 3 — End-of-day ritual
9. Cash reconciliation card: expected cash in drawer = cash collected − cash expenses.
10. Fix mixed-scope metrics: align or explicitly label "Outstanding turf dues" (turf-only)
    vs dashboard "Pending dues" (includes bills).
11. Merge the duplicate turf-dues KPI into the dues-list header, with overdue/current filter.

### Step 4 — Reports readability
12. Split the 6-month chart: revenue bars (Turf+Snacks) + expenses as a line/second chart,
    with a profit-margin % overlay.
13. Snack pie: add an "Others" bucket so it sums to 100%; show % and amount.
14. Mobile-first tables: item-wise sales and P&L as card lists under `use-mobile`,
    plus a collection-rate column (Collected / Revenue).
15. Section grouping: Performance / Trends / Details.
16. Insight cards: avg booking value, top expense category, best-selling snack, collection rate.

### Step 5 — New insight
17. Turf slot heatmap (hour × weekday) with occupancy %.
18. Sparklines (7-day micro-bars) inside every KPI card.
19. Customer health: repeat rate, top-10 by lifetime value, "at risk" (no booking in 45 days).
20. Snack margin % ranking + "high-selling but out of stock" flags.

### Step 6 — Reporting output
21. Branded PDF statement via `InvoiceBrandingCard` + `print.ts`.
22. Web Share / WhatsApp delivery of reports.
23. Sheet picker on the Excel export.
24. Multi-month range mode + same-month-last-year comparison column.
25. GST-ready tax sheet from `taxBreakdown()`.

### Step 7 — Advisory & polish
26. Insight strip: 2–3 plain-sentence callouts derived from `analytics.ts`.
27. Comparison card rewritten as a story (biggest mover first, one explanatory sentence).
28. Chart click-through: bar → that day's transactions, slice → filtered tab, month → set month.
29. Sidebar nav on desktop, icon rail on tablet, bottom tabs on mobile.
30. `Cmd/Ctrl+K` command palette (find customer, book slot, log expense).
31. Saved report templates + scheduled monthly summary (runs on app open when due).
32. Month-to-date run-rate forecast vs last month's actual.

---

## Codebase imported + theme fixes (done)
- [x] Step 0 — zip `src/` imported into this project (no `.git` copied).
- [x] Custom colours actually apply: theme engine now writes `oklch(...)` values
      (it previously wrote bare HSL triples the stylesheet ignored) and also drives
      derived surfaces (card, popover, muted, secondary, accent, border, input, sidebar).
- [x] Confirm dialog before saving custom colours; live preview + "Discard changes".
- [x] Colours survive reload: resolved CSS vars cached and re-applied pre-paint via
      `THEME_INIT_SCRIPT`, with `initTheme()` as a client safety net.
- [x] Removed the "Load 1,00,000 test records" button, its confirm dialog and the
      `generateTestData` generator (it wrote synthetic rows into live data).

## Colours card cleanup (done)
- [x] Single header row: theme name / "Unsaved" + Light/Dark segmented switch that
      flips the app mode and the pair being edited together.
- [x] Body in three steps: preset pills, collapsed Fine tune (wheels, sliders,
      "Generate matching…"), and a mini app preview in the mode being edited.
- [x] My themes as compact rows with one overflow menu (Rename / Update to current /
      Delete); active row checked; "Save current as…" only when there are unsaved changes.
- [x] Light/dark round-trip drift fixed: both modes' resolved CSS cached at save time,
      the toggle and the pre-paint script both read the cache instead of recomputing.
- [x] Surface colour transitions under `prefers-reduced-motion: no-preference`,
      rAF-throttled live preview, invalid hex keeps the previous colour.

## Frosted restyle — final pass (done)
- [x] Turf & Snacks group restyle (TurfTab, TimeSlotPicker, TurfCalendarCard, TurfUtilizationCard, SnacksTab, SnackStockCard, SnackSalesList, PopularSnacksCard)
- [x] Bills & Money group restyle (BillsTab, QuickPayRow, BillActions, CustomerDetailDialog, ExpensesTab, PaymentSplitCard)
- [x] Reports & Settings group restyle (ReportsTab, MonthlyReportCard, SettingsTab, BackupCard, ArchiveCard, CustomerDirectoryCard, PrintSettingsCard, InvoiceBrandingCard, BillingSettingsCard)
- [x] Final typecheck + browser pass across all tabs

## Money-math audit — closing pass (done)
- [x] Codebase re-imported here; deps installed, 55 tests + `scripts/verify-math.ts` pass.
- [x] Build/lint/typecheck clean: fixed `biz.ts` re-exporting `money` without importing it
      (broke the typecheck), and prettier-formatted the whole tree.
- [x] Browser pass with `verificationSeed.ts` data over Home / Turf / Snacks / Bills /
      Money / Dues / Reports — all figures whole rupees, no console errors,
      Jul ₹4,345 · Aug ₹7,255 on screen matching the headless simulation.
- [x] Money tab "This month" card was summing all-time income and mixing bill *paid*
      with turf *billed*; it now uses `statsForMonth` (tab ledger included).
