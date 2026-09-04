import { db, table, DATA_TABLES, type DataTable, type Row } from "./localdb";
import { saveFile } from "./desktop";

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
 * Saves a backup to disk/share. Returns the filename on success, or `null`
 * if the person cancelled (a desktop Save dialog or a mobile share sheet) —
 * callers use that to avoid claiming success when nothing was actually
 * saved anywhere. See `saveFile` in desktop.ts for the browser/desktop/
 * mobile split, including why mobile goes through the share sheet instead
 * of the same dialog+fs pairing desktop uses.
 */
export async function downloadBackup(
  backup: BackupFile,
  name = backupFileName(),
): Promise<string | null> {
  const text = JSON.stringify(backup, null, 2);
  const ok = await saveFile(text, name, "application/json", {
    name: "Ledger backup",
    extensions: ["db", "json"],
  });
  return ok ? name : null;
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
