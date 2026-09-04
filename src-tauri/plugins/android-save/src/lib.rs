//! Saves a generated file (PDF / Excel / JSON backup) into the *public*
//! Downloads folder on Android.
//!
//! Why this exists: on Android 10+ (scoped storage) the app can't write to
//! `/storage/emulated/0/Download` directly, and `tauri-plugin-fs` can't write
//! the `content://` URI the system save dialog hands back — that's what
//! produced 0-byte files. The only supported route is `MediaStore` (API 29+)
//! or a legacy `WRITE_EXTERNAL_STORAGE` write below that, which is what the
//! Kotlin side of this plugin does.
//!
//! On non-Android targets the command returns an error, and the TypeScript
//! caller falls back to the existing desktop/browser save paths.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.androidsave";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Plugin(String),
    #[cfg(target_os = "android")]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    /// File name including extension, e.g. `bill-1024.pdf`.
    pub file_name: String,
    /// MIME type, e.g. `application/pdf`.
    pub mime_type: String,
    /// File contents, base64 encoded (JSON can't carry raw bytes).
    pub base64: String,
    /// Open the saved file in the OS viewer afterwards (used by Print).
    #[serde(default)]
    pub open_after_save: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResponse {
    /// `content://` URI (API 29+) or absolute path of the saved file.
    pub uri: String,
    /// Bytes actually written — the TS side rejects 0 so a silent failure
    /// can never again look like a successful download.
    pub bytes_written: u64,
}

#[cfg(target_os = "android")]
pub struct AndroidSave<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
impl<R: Runtime> AndroidSave<R> {
    pub fn save_to_downloads(&self, payload: SaveRequest) -> Result<SaveResponse> {
        self.0
            .run_mobile_plugin("saveToDownloads", payload)
            .map_err(Into::into)
    }
}

#[cfg(not(target_os = "android"))]
pub struct AndroidSave<R: Runtime>(std::marker::PhantomData<R>);

#[cfg(not(target_os = "android"))]
impl<R: Runtime> AndroidSave<R> {
    pub fn save_to_downloads(&self, _payload: SaveRequest) -> Result<SaveResponse> {
        Err(Error::Plugin(
            "android-save is only available on Android".into(),
        ))
    }
}

pub trait AndroidSaveExt<R: Runtime> {
    fn android_save(&self) -> &AndroidSave<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidSaveExt<R> for T {
    fn android_save(&self) -> &AndroidSave<R> {
        self.state::<AndroidSave<R>>().inner()
    }
}

#[tauri::command]
fn save_to_downloads<R: Runtime>(
    app: tauri::AppHandle<R>,
    payload: SaveRequest,
) -> Result<SaveResponse> {
    app.android_save().save_to_downloads(payload)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-save")
        .invoke_handler(tauri::generate_handler![save_to_downloads])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidSavePlugin")?;
            #[cfg(target_os = "android")]
            app.manage(AndroidSave(handle));
            #[cfg(not(target_os = "android"))]
            app.manage(AndroidSave::<R>(std::marker::PhantomData));
            Ok(())
        })
        .build()
}
