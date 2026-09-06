/**
 * Desktop-shell detection.
 *
 * The same codebase ships to the browser/PWA and to the Tauri desktop build.
 * `isDesktop()` is the single place that decides which one we're in, so every
 * "browser vs native" fork in the app (backup.ts, github.ts, receipt.ts,
 * register-sw.ts) reads it from here instead of re-deriving it.
 *
 * Tauri v2 injects `window.__TAURI_INTERNALS__` into every webview at runtime
 * — that's the most reliable client-side signal (no build-time env var needed,
 * so a plain `vite build` output still runs correctly if it's ever loaded
 * inside a Tauri shell). We additionally check `window.__TAURI__` (present
 * when `app.withGlobalTauri` is enabled) as a fallback.
 */
export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w["__TAURI_INTERNALS__"] ?? w["__TAURI__"]);
}

/**
 * Opens an external URL (e.g. a wa.me WhatsApp link) the right way for the
 * current shell.
 *
 * Browser/PWA: plain `window.open`.
 *
 * Desktop (Tauri v2 / WebView2): `window.open` is unreliable inside a Tauri
 * webview — depending on the platform webview it is either a no-op or spawns
 * a second, chrome-less webview window rendering the remote site inside the
 * app, which is not the intent. `@tauri-apps/plugin-opener`'s `openUrl()`
 * hands the URL to the OS default browser instead (the plugin is registered
 * in src-tauri/src/lib.rs and permitted in
 * src-tauri/capabilities/default.json, scoped to https/http links only).
 */
export async function openExternal(url: string): Promise<boolean> {
  if (!isDesktop()) {
    window.open(url, "_blank", "noopener");
    return true;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return true;
  } catch {
    try {
      window.open(url, "_blank");
    } catch {
      /* nothing else we can do */
    }
    return false;
  }
}

/**
 * Root folder name under Windows' Documents (and the equivalent on
 * macOS/Linux) that all of the app's user-visible desktop files live under
 * — `Documents/TurfApp/Invoices/...`, `Documents/TurfApp/Receipts/...` —
 * so everything the app writes is easy to find in Explorer instead of
 * buried in the hidden AppData folder.
 */
const APP_DOCS_FOLDER = "TurfApp";

/**
 * Which `BaseDirectory` + resolver pair backs `APP_DOCS_FOLDER` on this
 * shell. On Windows/macOS/Linux this is always the user's Documents folder
 * (matches the doc comment above — Explorer-visible, no scoped-storage
 * restrictions). On Android, `documentDir()`/`BaseDirectory.Document` is not
 * guaranteed to resolve to a writable, app-accessible location the same way
 * — Android's scoped-storage rules are the whole reason §3 of
 * docs/android-port-notes.md exists — so this falls back to the app's own
 * private storage (`BaseDirectory.AppLocalData`, no permission prompt
 * needed) if the Documents directory isn't usable. This has **not** been
 * verified on a physical Android device yet; do that before relying on it,
 * per docs/android-port-notes.md.
 *
 * Cached after the first successful resolution so every subsequent call
 * doesn't re-probe.
 */
let cachedAppDocsBase: { baseDir: import("@tauri-apps/plugin-fs").BaseDirectory; root: () => Promise<string> } | null =
  null;

async function resolveAppDocsBase() {
  if (cachedAppDocsBase) return cachedAppDocsBase;
  const { BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const { documentDir, appLocalDataDir } = await import("@tauri-apps/api/path");
  try {
    const root = await documentDir();
    cachedAppDocsBase = { baseDir: BaseDirectory.Document, root: async () => root };
  } catch {
    // No usable Documents directory on this shell (expected on Android) —
    // fall back to app-private storage, which needs no runtime permission.
    cachedAppDocsBase = { baseDir: BaseDirectory.AppLocalData, root: appLocalDataDir };
  }
  return cachedAppDocsBase;
}

/**
 * Writes bytes straight to `<AppDocsBase>/TurfApp/<relativePath>` — no
 * native Save dialog. `relativePath` may include subfolders (e.g.
 * `Receipts/2026-09-04/xxxx.jpg`); any missing parent folders are created
 * lazily, and only the ones actually needed (no folder tree is pre-created).
 * Returns the absolute path, mainly so the caller can `revealInFolder` it.
 */
export async function saveToAppDocuments(relativePath: string, bytes: Uint8Array): Promise<string> {
  const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
  const { join, dirname } = await import("@tauri-apps/api/path");
  const { baseDir, root } = await resolveAppDocsBase();
  const full = `${APP_DOCS_FOLDER}/${relativePath}`;
  const dir = await dirname(full);
  await mkdir(dir, { baseDir, recursive: true });
  await writeFile(full, bytes, { baseDir });
  return join(await root(), full);
}

/** True if `<AppDocsBase>/TurfApp/<relativePath>` already exists. */
export async function appDocumentExists(relativePath: string): Promise<boolean> {
  const { exists } = await import("@tauri-apps/plugin-fs");
  const { baseDir } = await resolveAppDocsBase();
  return exists(`${APP_DOCS_FOLDER}/${relativePath}`, { baseDir });
}

/** Absolute path for `<AppDocsBase>/TurfApp/<relativePath>`, for opening/revealing. */
export async function appDocumentAbsPath(relativePath: string): Promise<string> {
  const { join } = await import("@tauri-apps/api/path");
  const { root } = await resolveAppDocsBase();
  return join(await root(), APP_DOCS_FOLDER, relativePath);
}

/**
 * Reads the raw bytes of `<AppDocsBase>/TurfApp/<relativePath>` back out.
 * Used anywhere the app needs to re-package a file it previously wrote
 * there (e.g. the receipts-sharing export in `receipts-share.ts`) rather
 * than just opening it for the person to view.
 */
export async function readAppDocument(relativePath: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const { baseDir } = await resolveAppDocsBase();
  return readFile(`${APP_DOCS_FOLDER}/${relativePath}`, { baseDir });
}

/**
 * Section subfolders under `Invoices/`, one per part of the app that
 * produces a saved document — so a person browsing Explorer sees
 * `Invoices/Turf/…`, `Invoices/Snacks/…`, etc. instead of every bill,
 * booking, expense export and merged invoice dumped into one flat list.
 * `saveToInvoicesFolder` accepts any of these (or a plain string, for
 * forward compatibility) as its optional `section` argument.
 */
export const INVOICE_SECTIONS = {
  turf: "Turf",
  snacks: "Snacks",
  bills: "Bills",
  merged: "Merged",
  expenses: "Expenses",
  reports: "Reports",
} as const;

export type InvoiceSection = (typeof INVOICE_SECTIONS)[keyof typeof INVOICE_SECTIONS];

/**
 * Writes bytes straight to the app's shared `Invoices/` folder under
 * `<AppDocsBase>/TurfApp/`. Bill/receipt PDF downloads, print copies, and
 * Excel exports all call this so they end up in the same top-level folder
 * instead of wherever the user happened to browse to last time. When
 * `section` is given, the file lands in that named subfolder (e.g.
 * `Invoices/Turf/…`) instead of directly under `Invoices/`, so each part
 * of the app keeps its own documents together. The folder is created
 * lazily on first write. Returns the absolute path, mainly so the caller
 * can `revealInFolder` it.
 */
export async function saveToInvoicesFolder(
  bytes: Uint8Array,
  filename: string,
  section?: InvoiceSection | (string & {}),
): Promise<string> {
  return saveToAppDocuments(`Invoices/${section ? `${section}/` : ""}${filename}`, bytes);
}

/**
 * Highlights a just-saved file in Windows Explorer (or the OS's file
 * manager on other desktop platforms) so the person can see where an
 * auto-saved PDF/Excel file landed, since there's no Save dialog to close
 * on top of it anymore. Best-effort — silently no-ops if unsupported,
 * which is the expected outcome on Android (no Explorer-equivalent to
 * reveal a file in — `capabilities/mobile.json` doesn't grant this
 * permission at all, so the underlying plugin call fails immediately and
 * is swallowed here).
 */
export async function revealInFolder(absPath: string): Promise<void> {
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(absPath);
  } catch {
    /* best-effort only */
  }
}
