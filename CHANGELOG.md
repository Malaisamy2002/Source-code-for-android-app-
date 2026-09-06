# Changelog

All notable changes to this consolidation are recorded here, newest first.

## [Unreleased]

### Added
- Cash/UPI payment-mode picker on every tab-payment collection point: the
  Dues tab collect box, "Settle all", and the customer tab card. The chosen
  mode is saved on the payment record and shown in the ledger.
- `theme.test.ts`: verifies the resolved-CSS theme cache — `applyTheme()`
  caches both light and dark CSS in one call, and `applyCachedMode()`
  restores byte-identical values on every light ⇄ dark toggle instead of
  re-running the color math.
- `expenses.test.ts`: regression coverage for `planRecurringPosts()` — IST
  day-of-month arrival, the plain `YYYY-MM-DD` `spent_at` shape, and the
  31st-clamped-to-month-end rule.
- IST calendar-bucketing test cases appended to `analytics.test.ts` for
  `dayKey()`/`monthKey()`, including cross-midnight UTC/IST cases and
  runtime-timezone independence.

### Fixed
- Four remaining UTC-vs-IST date slices, all following the same rule already
  documented in `docs/calculation-rules.md` (route through `monthKey()`/
  `dayKey()`, never re-slice a UTC timestamp):
  - Excel export filenames (`xlsx.ts`)
  - Layout-preset export filenames (`ArrangeToolbar.tsx`)
  - The print-test receipt date (`PrintSettingsCard.tsx`)
  - Recurring-expense auto-posting (`expenses.ts`) — auto-posted rows now
    store a plain local date like every other expense (previously a UTC
    `toISOString()` that plain-date-equality filters, like the day filter
    and the receipt-upload folder, silently never matched), post on the IST
    calendar day rather than the runtime's local day, and clamp a rule for
    "the 31st" to the last day of a shorter month instead of rolling into
    the next month.

### Changed
- Settings tab reordered to a usage-priority sequence — data-safety tools
  (Backup & restore, Receipts sharing) first, daily operational settings
  next, occasional/advanced tools last — per
  `.lovable/plan/optimize-the-settings-tab-order-2026-09-05.md`. Existing
  saved layouts are migrated to the new order once; later manual
  rearrangements are preserved and not repeatedly overwritten.
- `docs/README-theme-picker.md` rewritten: it previously described an older
  HSL, single-mode version of the theme engine. It now documents the actual
  oklch color space, the independent light/dark color pairs, the
  contrast-safety clamps, and the resolved-CSS cache.
- `docs/calculation-rules.md` updated to list the call sites already audited
  against the UTC/IST date rule.

### Known gaps
- The roadmap line "theme card redesign / resolved-CSS cache verification"
  had two parts. Only the cache-verification half had a concrete, checkable
  spec (now done, see `theme.test.ts`). No design brief for a
  `ThemeCustomizerCard.tsx` visual redesign was found anywhere in the repo
  (`.lovable/plan/`, `roadmap.md`, or elsewhere) — if one was intended, it
  needs its own spec before that work can start.
