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
 * Mobile (Android/iOS): public Downloads can't be written directly on Android
 * 10+ (scoped storage), and the save dialog returns a `content://` URI that
 * `tauri-plugin-fs` can't write to reliably. `navigator.share()` is also
 * unavailable because Tauri's webview is not a secure (HTTPS) context. The
 * reliable path is to write into the app's private storage
 * (`BaseDirectory.AppData`) and then open the file with the OS default app
 * (`tauri-plugin-opener` on mobile). That gives the user a real file they can
 * share, print, or save to Downloads from the viewer.
 *
 * Returns `false` only when the write itself failed — callers use that to
 * avoid claiming success or deleting data that was never actually saved.
 */
/** Bytes -> base64, chunked so large PDFs/workbooks don't blow the stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function saveFile(
  data: Uint8Array | string,
  filename: string,
  mimeType: string,
  dialogFilter?: { name: string; extensions: string[] },
  openAfterSave = true,
): Promise<boolean> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

  if (bytes.byteLength === 0) {
    console.error("saveFile: refusing to save empty file", filename);
    return false;
  }

  if (isMobileShell()) {
    // 1st choice on Android: the native MediaStore writer (Rust/Kotlin plugin
    // in src-tauri/plugins/android-save). This is the only supported way to
    // put a file in the *public* Downloads folder on Android 10+, and it
    // reports back how many bytes really landed, so a blocked write can no
    // longer look like a successful download.
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ uri: string; bytesWritten: number }>(
        "plugin:android-save|save_to_downloads",
        {
          payload: {
            fileName: filename,
            mimeType,
            base64: toBase64(bytes),
            openAfterSave: openAfterSave,
          },
        },
      );
      if (result && result.bytesWritten > 0) return true;
      console.error("saveFile: native Downloads write reported 0 bytes", result);
    } catch (nativeErr) {
      console.warn("saveFile: native Downloads write unavailable", nativeErr);
    }

    // Fallback (iOS, or if the native plugin is missing): app-private storage
    // plus "open with", which the user can then save or share from.
    try {
      const { writeFile, BaseDirectory, mkdir } = await import("@tauri-apps/plugin-fs");
      const { appDataDir } = await import("@tauri-apps/api/path");
      const folder = "exports";
      await mkdir(folder, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {});
      const relativePath = `${folder}/${filename}`;
      await writeFile(relativePath, new Uint8Array(bytes), { baseDir: BaseDirectory.AppData });
      try {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        const base = await appDataDir();
        const separator = base.endsWith("/") ? "" : "/";
        await openPath(`${base}${separator}${relativePath}`);
      } catch (openErr) {
        console.warn("saveFile: could not open saved file", openErr);
      }
      return true;
    } catch (err) {
      console.error("saveFile: mobile AppData write failed", err);
      return false;
    }
  }



  if (isDesktop()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: filename,
      ...(dialogFilter ? { filters: [dialogFilter] } : {}),
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
