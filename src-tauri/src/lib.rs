// Backs the GitHub backup PAT storage called from src/lib/github.ts. Real
// implementation on Windows (Windows Credential Manager, via the `keyring`
// crate — see the target-specific dependency in Cargo.toml); everywhere
// else these are stubs, because github.ts's `isDesktop() && !isMobileShell()`
// check only calls them on the real desktop shell in the first place — this
// project doesn't currently ship macOS/Linux desktop builds (tauri.conf.json
// bundle targets are nsis/msi only), so the stub branch below only exists
// so the same `generate_handler!` list compiles if that ever changes.
#[cfg(target_os = "windows")]
mod keyring_native {
    use keyring::Entry;

    #[tauri::command]
    pub fn keyring_get_token(service: String, account: String) -> Result<Option<String>, String> {
        let entry = Entry::new(&service, &account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    #[tauri::command]
    pub fn keyring_set_token(service: String, account: String, token: String) -> Result<(), String> {
        let entry = Entry::new(&service, &account).map_err(|e| e.to_string())?;
        entry.set_password(&token).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn keyring_delete_token(service: String, account: String) -> Result<(), String> {
        let entry = Entry::new(&service, &account).map_err(|e| e.to_string())?;
        match entry.delete_password() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod keyring_native {
    #[tauri::command]
    pub fn keyring_get_token(_service: String, _account: String) -> Result<Option<String>, String> {
        Err("not supported on this platform".into())
    }

    #[tauri::command]
    pub fn keyring_set_token(
        _service: String,
        _account: String,
        _token: String,
    ) -> Result<(), String> {
        Err("not supported on this platform".into())
    }

    #[tauri::command]
    pub fn keyring_delete_token(_service: String, _account: String) -> Result<(), String> {
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            keyring_native::keyring_get_token,
            keyring_native::keyring_set_token,
            keyring_native::keyring_delete_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
