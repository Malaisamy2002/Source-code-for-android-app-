import type { BackupFile } from "./backup";
import { isAndroid, isDesktop, saveExportFile } from "./desktop";
import { db, resyncCounters } from "./localdb";
import {
  githubPushFileAt,
  isGithubConfigured,
  readGithubConfig,
  type GithubConfig,
} from "./github";
import {
  deleteYear,
  distinctYears,
  rowsForYear,
  RETAINED_YEARS,
  YEAR_TABLES,
  type YearTable,
} from "./years";

/**
 * Year archiving.
 *
 * The app keeps `RETAINED_YEARS` years of data. When an extra year appears, the
 * oldest year is exported to a file named after the year, pushed to GitHub as a
 * new separate file, downloaded for the "Turf bookings and sales" folder, and
 * only then removed from the local database.
 */

export type YearArchive = BackupFile & { year: number; archived_at: string };

export type ArchiveRecord = {
  year: number;
  archived_at: string;
  rows: number;
  github_path: string | null;
  file_name: string;
};

const LOG_KEY = "ks:archive-log";
const SKIP_KEY = "ks:archive-skipped";

export function readArchiveLog(): ArchiveRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(LOG_KEY) ?? "[]") as ArchiveRecord[];
  } catch {
    return [];
  }
}

function writeArchiveLog(rows: ArchiveRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOG_KEY, JSON.stringify(rows));
}

/** "Remind me later" for the current session only. */
export function skipArchiveForNow(year: number) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SKIP_KEY, String(year));
}

export function isArchiveSkipped(year: number) {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(SKIP_KEY) === String(year);
}

/** Oldest year that must leave the app, or null when within the retention window. */
export async function yearDueForArchive(): Promise<number | null> {
  const years = await distinctYears();
  if (years.length <= RETAINED_YEARS) return null;
  return years[0] ?? null;
}

export async function yearRowCount(year: number) {
  let total = 0;
  for (const name of Object.keys(YEAR_TABLES) as YearTable[]) {
    total += (await rowsForYear(name, year)).length;
  }
  return total;
}

/** Builds a snapshot holding only the given year's dated records. */
export async function buildYearArchive(year: number): Promise<YearArchive> {
  const tables: BackupFile["tables"] = {};
  for (const name of Object.keys(YEAR_TABLES) as YearTable[]) {
    tables[name] = (await rowsForYear(name, year)) as Record<string, unknown>[];
  }
  // Customers are kept in the app, but copied along so the archive reads on its own.
  tables["customers"] = (await db.customers.toArray()) as unknown as Record<string, unknown>[];

  return {
    format: "turf-snack-ledger",
    version: 1,
    exported_at: new Date().toISOString(),
    year,
    archived_at: new Date().toISOString(),
    tables,
  };
}

export const archiveFileName = (year: number) => `Turf bookings and sales - ${year}.db`;

export function githubArchivePath(cfg: GithubConfig, year: number) {
  const base = (cfg.path || "backups/turf-ledger.db").replace(/^\/+/, "");
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "backups";
  return `${dir}/turf-ledger-${year}.db`;
}

/**
 * Saves the archive snapshot. Browser/PWA: Blob download, same as before.
 * Desktop: native Save dialog + `tauri-plugin-fs`, matching backup.ts's
 * `downloadBackup`. Returns `false` if a desktop Save dialog was cancelled,
 * so `archiveYear` below can stop before deleting anything — the archive
 * must not be considered "downloaded" if the user backed out of the dialog.
 *
 * Android is matched before the generic desktop branch and skips that Save
 * dialog entirely: on Android, `save()` hands back a `content://` URI that
 * `writeTextFile()` cannot actually write to — it fails silently rather than
 * throwing, so this used to return `true` (a real path, from the dialog)
 * while leaving a 0-byte file on disk. That's the worst possible failure
 * mode for this specific function: `archiveYear` deletes the local rows
 * right after `downloadText` reports success, so a silent 0-byte write here
 * meant permanently losing a year of bookings/sales with no usable backup of
 * them anywhere. Routing Android through `saveExportFile` (the same
 * MediaStore-backed plugin used for backups/exports) makes the write
 * actually succeed-or-fail honestly, so that guarantee holds again.
 */
async function downloadText(text: string, name: string): Promise<boolean> {
  if (isAndroid()) {
    const bytes = new TextEncoder().encode(text);
    const result = await saveExportFile(bytes, name, "application/json");
    return result.saved;
  }
  if (isDesktop()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: name,
      filters: [{ name: "Ledger archive", extensions: ["db", "json"] }],
    });
    if (!path) return false;
    await writeTextFile(path, text);
    return true;
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

export type ArchiveResult = { year: number; rows: number; githubPath: string; fileName: string };

/**
 * Archives one year: GitHub push (new file) → local download → delete rows.
 * Any failure before the delete leaves the data untouched — including the
 * user cancelling the desktop Save dialog, which is treated the same as a
 * failure (see `downloadText` above).
 */
export async function archiveYear(year: number): Promise<ArchiveResult> {
  const cfg = await readGithubConfig();
  if (!isGithubConfigured(cfg))
    throw new Error("Set up GitHub backup in Settings first — nothing was deleted.");

  const snapshot = await buildYearArchive(year);
  const rows = Object.entries(snapshot.tables)
    .filter(([t]) => t !== "customers")
    .reduce((n, [, list]) => n + list.length, 0);

  if (rows === 0) throw new Error(`No ${year} records found to archive.`);

  const text = JSON.stringify(snapshot, null, 2);
  const githubPath = githubArchivePath(cfg, year);
  await githubPushFileAt(cfg, githubPath, text, `Archive ${year} turf bookings and sales`);

  const fileName = archiveFileName(year);
  const saved = await downloadText(text, fileName);
  if (!saved)
    throw new Error(
      `Archived to GitHub but the local save didn't complete — nothing was deleted. Re-run the archive to save a local copy too.`,
    );

  await deleteYear(year);
  await resyncCounters();

  const record: ArchiveRecord = {
    year,
    archived_at: new Date().toISOString(),
    rows,
    github_path: githubPath,
    file_name: fileName,
  };
  writeArchiveLog([record, ...readArchiveLog().filter((r) => r.year !== year)]);

  return { year, rows, githubPath, fileName };
}
