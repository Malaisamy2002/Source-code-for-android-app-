# Android port — progress notes

Tracks what's been done against `docs/android-app-build-prompt.md`, and what
still needs a real device/Android Studio to finish (this pass was done
without network access, so nothing native could be scaffolded or built).

## Done in this pass (source-only, no native build)

- **CI**: added `.github/workflows/build-android.yml`, parallel to the
  existing `build-windows-installer.yml`. It runs `tauri android init` fresh
  on GitHub's Ubuntu runner (network + Android SDK available there, unlike
  this sandbox), installs the NDK + Rust Android targets, and builds a
  **debug** APK as a downloadable workflow artifact. Release signing is
  deliberately left as a documented stub at the bottom of that file — it
  needs `gen/android/app/build.gradle.kts` to actually exist and be
  inspected first, which only happens once this workflow (or a local
  `tauri android init`) has actually run once. **This workflow has not been
  run yet** — the NDK version pin (`27.0.12077973`) and the
  `tauri android init --ci` / `tauri android build --apk --debug` flags are
  based on current Tauri v2 CLI conventions, not verified against an actual
  run's log. Check the Actions tab after pushing this and adjust the NDK
  version / flags if either step fails.
- **§6 UI — notch space**: `src/routes/index.tsx`'s sticky header now has
  `pt-[env(safe-area-inset-top)]` on the outer `<header>`, so the
  brand-gradient background still fills the status-bar/cutout area but the
  logo/title/nav content sits below it. `env()` is `0` on browsers/desktop
  that don't need it, so this is a no-op there — verified no other
  `fixed`/`sticky` top-anchored elements exist (checked the Sonner toaster,
  which is `position="bottom-right"` already, and found no other top-fixed
  overlays).
- **§3 filesystem**: `src/lib/desktop.ts`'s `saveToAppDocuments` /
  `appDocumentExists` / `appDocumentAbsPath` / `readAppDocument` no longer
  hard-code `BaseDirectory.Document`. They now call a new
  `resolveAppDocsBase()` that tries `documentDir()` first (desktop's exact
  existing behavior — unchanged) and falls back to
  `BaseDirectory.AppLocalData` if resolving the Documents directory throws.
  This covers the app-private half of §3 (auto-saved PDFs/Excel/receipt
  photos) without touching call sites in `expenses.ts`, `receipt.ts`,
  `report-pdf.ts`, `xlsx.ts`, `receipts-share.ts` — they all go through
  `desktop.ts`, so the fix is in one place.
- **Capabilities scaffold**: added `src-tauri/capabilities/mobile.json`,
  parallel to the existing `default.json`, scoped to
  `$APPDATA/TurfApp/**` and `$APPLOCALDATA/TurfApp/**` instead of
  `$DOCUMENT/TurfApp/**`, and drops `opener:allow-reveal-item-in-dir` (no
  Android equivalent to Explorer's "reveal in folder"). **Correction from an
  earlier pass**: this file originally had `"platforms": ["android", "iOS"]`
  — removed on a re-check, since the exact enum casing Tauri's capability
  schema expects wasn't verified, and an invalid value there risks failing
  to parse the *entire* capability set (breaking every platform's build, not
  just Android) rather than just failing to scope correctly. The file now
  applies unconditionally, which is harmless (see the note left in the
  file's own `description` field) until the correct casing is confirmed
  against the schema Tauri generates and the restriction is added back.

## Not done — needs Android Studio / a device / network, none of which this
## environment has

- **Nothing has actually been built.** `tauri android init` was not
  executed by hand here — that requires downloading the Android Gradle
  plugin and NDK components, which needs network access this sandbox
  doesn't have. `src-tauri/gen/android/` does not exist in this snapshot.
  The new `build-android.yml` workflow (see above) runs `tauri android init`
  for you on push/dispatch, but it hasn't executed even once yet — push it
  and check the Actions tab before trusting any of its assumptions. To do
  the same locally instead of via CI:
  ```
  bun install
  bun run tauri android init
  bun run tauri android dev    # or `android build` for a release .aab/.apk
  ```
- **`resolveAppDocsBase()`'s fallback path is unverified**, in two ways:
  1. It assumes `documentDir()` *throws* on Android rather than silently
     resolving to something unwritable or restricted. If it turns out
     `documentDir()` resolves without throwing but scoped-storage still
     blocks the actual `writeFile`/`mkdir` call, the try/catch needs to move
     around those calls instead of just the path resolution.
  2. It assumes `BaseDirectory.AppLocalData` exists as an enum member on the
     installed `@tauri-apps/plugin-fs` version — plausible (it mirrors
     Tauri v1's naming) but not checked against this project's actual
     `^2.5.1` pin. If a typecheck/build fails on that reference, that's why.
  Test both on a real device before trusting either.
- **`capabilities/mobile.json`'s `$schema` path** (`../gen/schemas/mobile-schema.json`)
  hasn't been checked against the actual schema Tauri generates — that file
  doesn't exist until `tauri android init` has been run once. Regenerate/
  adjust it against whatever shows up in `gen/schemas/` afterward. Separately,
  the file no longer has a `"platforms"` restriction at all (removed on a
  re-check — see the bullet above) — add it back once the correct enum
  casing (`"android"`/`"ios"` vs `"Android"`/`"iOS"`, unconfirmed) is known,
  so this scope doesn't sit unnecessarily on the desktop/browser builds too.
- **The SAF (Storage Access Framework) picker for user-facing exports**
  (§3b — backup export/import, receipts-zip sharing) is not implemented.
  This needs either confirming the installed `@tauri-apps/plugin-dialog` /
  `plugin-fs` versions support Android's `ACTION_OPEN_DOCUMENT_TREE` picker,
  or writing a small custom Kotlin plugin if they don't — that's native
  Android code this environment can't write blind without the actual plugin
  API surface in front of it.
- **GitHub token storage on Android** (§4) — the Android Keystore /
  `EncryptedSharedPreferences`-backed `keyring_get_token` /
  `keyring_set_token` / `keyring_delete_token` implementation is not
  written. Also still unresolved from the original audit: confirm whether
  those three commands are even registered for the *desktop* build today —
  `src-tauri/src/lib.rs` in this snapshot only registers `opener`, `fs`, and
  `dialog` plugins, no keyring plugin or custom command handlers. If
  desktop doesn't actually have this working yet either, that's a
  pre-existing gap, not something introduced by the Android work.
- **Fluid GitHub transfer** (§4) — `src/lib/github.ts`'s `toBase64`/
  `fromBase64` still encode/decode the whole backup payload synchronously.
  Not changed in this pass since it's a behavior/perf change best validated
  with a real large dataset and on-device profiling, not guessed at blind.
- **Share sheet / print** (§5), **back-button handling, touch-target audit,
  icons/splash** (§6), and the **Tauri Android project + Gradle/signing
  setup** (§8) are all still open — every one of them needs either the
  generated `gen/android/` project, a device/emulator, or both.

## Suggested next step

Run `bun install && bun run tauri android init` on a machine with Android
Studio + the NDK installed, commit the generated `gen/android/` project,
then come back to this list — most of the remaining items (SAF picker,
keyring plugin, share-sheet plugin, back-button wiring) need that generated
project to exist before they can be written against real APIs instead of
guessed at.
