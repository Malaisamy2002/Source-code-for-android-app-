// Plugin registration for the desktop shell.
//
// - tauri-plugin-opener: backs `openExternal()` in `src/lib/desktop.ts`
//   (hands wa.me / external links to the OS default browser instead of
//   opening a second chrome-less webview), and `revealInFolder()`
//   (highlights a just-saved PDF/Excel file in Explorer).
// - tauri-plugin-fs: backs `saveToAppDocuments()` / `saveToInvoicesFolder()`,
//   which write straight to `Documents/TurfApp/...` with no Save dialog.
// - tauri-plugin-dialog: available for any native file/save dialogs used
//   elsewhere in the app.
//
// Permissions for all three are scoped in `capabilities/default.json`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
