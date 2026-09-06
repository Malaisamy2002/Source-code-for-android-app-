import { db, table, DATA_TABLES, type DataTable, type Row } from "./localdb";
import { isAndroid, isDesktop, saveExportFile } from "./desktop";

export const BACKUP_TABLES = DATA_TABLES;

export type BackupTable = DataTable;

export type BackupFile = {
  format: "turf-snack-ledger";
  version: 1;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
};

/** Reads every local table into one portable snapshot. */
export async function buildBackup(): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = (await table(t).toArray()) as Record<string, unknown>[];
  }
  return {
    format: "turf-snack-ledger",
    version: 1,
    exported_at: new Date().toISOString(),
    tables,
  };
}

export function backupFileName() {
  return `turf-ledger-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.db`;
}

/**
 * Saves a backup to disk. In the browser/PWA this is a Blob + `<a download>`
 * click (fire-and-forget, no result). In the desktop shell it opens a native
 * Save dialog via `tauri-plugin-dialog` + `tauri-plugin-fs`; returns the path
 * the user chose, or `null` if they cancelled the dialog.
 *
 * Android is matched before the generic desktop branch and does NOT use that
 * Save dialog: `tauri-plugin-dialog`'s `save()` hands back a `content://`
 * URI on Android that `tauri-plugin-fs`'s `writeTextFile()` cannot write to
 * — it does not throw, it just silently produces a 0-byte file (see
 * `saveExportFile`'s doc comment in desktop.ts). That's a real correctness
 * risk here specifically, since `archiveYear` in archive.ts (which shares
 * this same dialog+fs pattern) deletes local rows once its own download
 * reports success — a silently-empty backup would mean deleted data with no
 * usable copy anywhere. Android instead writes through the bundled
 * `android-save` plugin straight into the public Downloads folder, with no
 * dialog and thus no "cancelled" outcome — just saved or not.
 *
 * Kept async (the browser branch always did the work synchronously, so
 * existing unawaited call sites keep working unchanged) so BackupCard/
 * ArchiveCard can `await` it to know whether a desktop save was cancelled
 * (or an Android save failed).
 */
export async function downloadBackup(
  backup: BackupFile,
  name = backupFileName(),
): Promise<string | null> {
  const text = JSON.stringify(backup, null, 2);

  if (isAndroid()) {
    const bytes = new TextEncoder().encode(text);
    const result = await saveExportFile(bytes, name, "application/json");
    return result.saved ? (result.path ?? name) : null;
  }

  if (isDesktop()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: name,
      filters: [{ name: "Ledger backup", extensions: ["db", "json"] }],
    });
    if (!path) return null; // user cancelled — caller should not claim success
    await writeTextFile(path, text);
    return path;
  }

  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

/**
 * Opens a native file-open dialog and reads the chosen backup. Desktop-only —
 * the browser build keeps using the `<input type="file">` element already in
 * BackupCard.tsx, since a plain `<input>` has no native-dialog equivalent to
 * call from here. Returns `null` if the user cancelled.
 */
export async function pickBackupFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const path = await open({
    multiple: false,
    filters: [{ name: "Ledger backup", extensions: ["db", "json"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return readTextFile(path);
}

export function parseBackup(text: string): BackupFile {
  const parsed = JSON.parse(text) as BackupFile;
  if (parsed?.format !== "turf-snack-ledger" || !parsed.tables)
    throw new Error("Not a valid ledger backup file");
  return parsed;
}

export function backupSummary(backup: BackupFile) {
  return BACKUP_TABLES.map((t) => `${t}: ${backup.tables[t]?.length ?? 0}`).join(" · ");
}

/**
 * Restores a snapshot. `mode: "replace"` wipes current rows first;
 * `mode: "merge"` keeps existing rows and adds only the ones missing.
 */
export async function restoreBackup(backup: BackupFile, mode: "replace" | "merge" = "replace") {
  let inserted = 0;

  await db.transaction(
    "rw",
    BACKUP_TABLES.map((t) => table(t)),
    async () => {
      if (mode === "replace") {
        for (const t of [...BACKUP_TABLES].reverse()) {
          await table(t).clear();
        }
      }

      for (const t of BACKUP_TABLES) {
        const rows = (backup.tables[t] ?? []) as Row[];
        if (rows.length === 0) continue;
        const target = table(t);
        if (mode === "merge") {
          const existing = new Set((await target.toArray()).map((r) => String(r["id"])));
          const fresh = rows.filter((r) => !existing.has(String(r["id"])));
          if (fresh.length === 0) continue;
          await target.bulkAdd(fresh);
          inserted += fresh.length;
        } else {
          await target.bulkPut(rows);
          inserted += rows.length;
        }
      }
    },
  );

  return inserted;
}
