package app.tauri.androidsave

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class SaveArgs {
    lateinit var fileName: String
    lateinit var mimeType: String
    lateinit var base64: String
    /** Open the saved file in a viewer afterwards (used by Print). */
    var openAfterSave: Boolean = false
}

@TauriPlugin
class AndroidSavePlugin(private val activity: Activity) : Plugin(activity) {

    /**
     * Writes the bytes into the device's public Downloads folder.
     *
     * API 29+ : MediaStore.Downloads insert + OutputStream (no permission needed,
     *           and unlike direct filesystem writes it is not silently blocked,
     *           which is what left 0-byte files behind).
     * API 24-28: legacy direct write to the public Downloads directory.
     */
    @Command
    fun saveToDownloads(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SaveArgs::class.java)
            val bytes = Base64.decode(args.base64, Base64.DEFAULT)
            if (bytes.isEmpty()) {
                invoke.reject("refusing to save an empty file")
                return
            }

            val uriString: String
            var written = 0L

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = activity.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, args.fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, args.mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: run {
                        invoke.reject("MediaStore refused to create the file")
                        return
                    }
                resolver.openOutputStream(uri)?.use { out ->
                    out.write(bytes)
                    out.flush()
                    written = bytes.size.toLong()
                } ?: run {
                    resolver.delete(uri, null, null)
                    invoke.reject("could not open an output stream for the new file")
                    return
                }
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                uriString = uri.toString()

                if (args.openAfterSave) openUri(uri.toString(), args.mimeType, false)
            } else {
                val dir = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS
                )
                if (!dir.exists()) dir.mkdirs()
                val target = uniqueFile(dir, args.fileName)
                target.outputStream().use { it.write(bytes) }
                written = target.length()
                uriString = target.absolutePath
                if (args.openAfterSave) openFile(target, args.mimeType)
            }

            if (written == 0L) {
                invoke.reject("file was created but nothing was written")
                return
            }

            val result = JSObject()
            result.put("uri", uriString)
            result.put("bytesWritten", written)
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.toString())
        }
    }

    private fun uniqueFile(dir: File, name: String): File {
        var candidate = File(dir, name)
        if (!candidate.exists()) return candidate
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var i = 1
        while (candidate.exists()) {
            candidate = File(dir, "$stem ($i)$ext")
            i++
        }
        return candidate
    }

    private fun openUri(uri: String, mimeType: String, grantWrite: Boolean) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(android.net.Uri.parse(uri), mimeType)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            if (grantWrite) addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        runCatching { activity.startActivity(intent) }
    }

    private fun openFile(file: File, mimeType: String) {
        val uri = runCatching {
            FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        }.getOrNull() ?: android.net.Uri.fromFile(file)
        openUri(uri.toString(), mimeType, false)
    }
}
