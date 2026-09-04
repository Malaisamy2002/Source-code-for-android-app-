import ExcelJS from "exceljs";
import { saveFile } from "./desktop";

export type SheetRow = Record<string, string | number>;

/**
 * A sheet spec is either the plain flat-table shape (`rows`, rendered via
 * `json_to_sheet`-style header + row dump) or a `build` callback for sheets
 * that need real styling — merged cells, fills, conditional formatting —
 * that a flat row list can't express. `build` gets the freshly-created
 * worksheet and does whatever it needs directly against the ExcelJS API.
 *
 * The flat shape also accepts two opt-in flags for record-level "raw data"
 * sheets: `autofilter` adds a filter dropdown to the header row and freezes
 * it so it stays visible while scrolling, and `moneyColumns` right-aligns
 * and thousand-separates the named columns instead of leaving them as plain
 * numbers. Existing callers that don't pass these get the exact same output
 * as before.
 */
export type SheetSpec =
  | { name: string; rows: SheetRow[]; autofilter?: boolean; moneyColumns?: string[] }
  | { name: string; build: (ws: ExcelJS.Worksheet) => void };

/** Download an array of flat objects as an .xlsx file. */
export function exportToExcel(rows: SheetRow[], filename: string, sheetName = "Sheet1") {
  return exportWorkbook([{ name: sheetName, rows }], filename);
}

/**
 * Download several sheets in one workbook. Empty flat-row sheets are kept
 * with a placeholder row.
 *
 * In the browser/PWA we build the workbook bytes with ExcelJS and trigger a
 * Blob + `<a download>` click ourselves (ExcelJS has no writeFile-style
 * browser helper like SheetJS did). The desktop shell's Tauri WebView can't
 * do that trick either — same reason receipt.ts and backup.ts fork on
 * `isDesktop()` — so there we write the same bytes out via a native Save
 * dialog + `tauri-plugin-fs`, exactly like `downloadReceipt`/`downloadBackup`
 * already do.
 */
export async function exportWorkbook(sheets: SheetSpec[], filename: string) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));

    if ("build" in s) {
      s.build(ws);
      continue;
    }

    const rows = s.rows.length ? s.rows : [{ Info: "No records" }];
    const keys = Object.keys(rows[0] ?? {});
    ws.columns = keys.map((k) => ({
      header: k,
      key: k,
      width: Math.min(
        32,
        Math.max(k.length + 2, ...rows.map((r) => String(r[k] ?? "").length + 2)),
      ),
    }));
    ws.getRow(1).font = { bold: true };

    for (const r of rows) ws.addRow(r);

    // Only meaningful when there's real data — an empty sheet just has the
    // "No records" placeholder row, which a filter/format pass would target
    // pointlessly (and "No records" isn't a number `moneyColumns` could
    // format anyway).
    if (rows.length && s.rows.length) {
      if (s.moneyColumns?.length) {
        for (const col of s.moneyColumns) {
          const idx = keys.indexOf(col);
          if (idx === -1) continue;
          ws.getColumn(idx + 1).numFmt = "#,##0";
        }
      }
      if (s.autofilter) {
        ws.views = [{ state: "frozen", ySplit: 1 }];
        ws.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: rows.length + 1, column: keys.length },
        };
      }
    }
  }
  const name = `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  await saveFile(
    new Uint8Array(buffer),
    name,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    { name: "Excel", extensions: ["xlsx"] },
  );
}
