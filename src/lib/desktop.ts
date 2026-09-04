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
 * True when running inside Tauri's Android or iOS webview specifically, as
 * opposed to the Windows/macOS/Linux desktop shell. `isDesktop()` is true
 * for both (same `__TAURI_INTERNALS__` global), but several things that
 * "just work" on the Windows WebView2 shell don't on Android/iOS:
 * `contentWindow.print()` is unimplemented in Android's system WebView (it
 * silently does nothing — there's no error to catch), `openPath()` from
 * `tauri-plugin-opener` only supports opening URLs on mobile (not local
 * files), and `window.open()` has no "new tab" to open into. Call sites for
 * those need a mobile-specific fallback instead of assuming desktop
 * behaviour just because `isDesktop()` is true.
 */
export function isMobileShell(): boolean {
  if (!isDesktop()) return false;
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
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
 * Saves bytes/text to a file, across all three shells this app ships to.
 * Used by every "download" button in the app (Excel export, receipt/report
 * PDFs, backups, year archives) so the fix below only has to exist once.
 *
 * Browser/PWA: plain Blob + `<a download>` click (unchanged, always worked).
 *
 * Desktop (Windows/macOS/Linux): native Save dialog (`tauri-plugin-dialog`)
 * + native write (`tauri-plugin-fs`). Solid here — WebView2/WebKit hand the
 * dialog a normal filesystem path.
 *
 * Mobile (Android/iOS): the same dialog+fs pairing is a known source of
 * files that get "created" but end up with 0 bytes. Android's save dialog
 * returns a SAF `content://` URI, not a filesystem path, and writing
 * through that URI via `tauri-plugin-fs` is unreliable — this is a
 * documented issue in Tauri's own plugin repo (writes reporting success but
 * not landing on disk / Google Drive, tauri-apps/plugins-workspace#3109)
 * and in Tauri's core repo for binary writes generally (tauri-apps/tauri
 * #1094), and the Tauri team's own guidance has been to avoid writing to a
 * dialog-picked path on Android at all (tauri-apps/tauri discussion
 * #10325). So on mobile we skip the Save dialog entirely and hand the
 * bytes straight to the OS share sheet (`navigator.share`) — the person
 * picks "Save to Drive", "Save to Downloads", or any app that takes files.
 * If the share sheet isn't available for some reason, we still attempt the
 * dialog+fs path as a last resort rather than doing nothing.
 *
 * Returns `false` only when the person cancelled (a Save dialog or the
 * share sheet) — callers use that to avoid claiming success or deleting
 * data that was never actually saved anywhere.
 */
export async function saveFile(
  data: Uint8Array | string,
  filename: string,
  mimeType: string,
  dialogFilter?: { name: string; extensions: string[] },
): Promise<boolean> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

  if (isMobileShell()) {
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    const file = new File([new Uint8Array(bytes)], filename, { type: mimeType });
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file] });
        return true;
      } catch {
        return false; // person backed out of the share sheet
      }
    }
    // Web Share unavailable — fall through to the dialog+fs attempt below,
    // which at least has a chance of working rather than doing nothing.
  }

  if (isDesktop()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: filename,
      filters: dialogFilter ? [dialogFilter] : undefined,
    });
    if (!path) return false; // user cancelled
    await writeFile(path, new Uint8Array(bytes));
    return true;
  }

  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
