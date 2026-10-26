package com.brwnindustries.agentprogress.update

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import com.brwnindustries.agentprogress.BuildConfig
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class UpdateInfo(
    val updateAvailable: Boolean,
    val remoteVersionCode: Int,
    val remoteVersionName: String,
    val apkUrl: String,
    val sha256: String
)

object UpdateChecker {
    private const val TAG = "UpdateChecker"

    @Suppress("UNUSED_PARAMETER")
    fun check(context: Context): UpdateInfo? {
        return try {
            val conn = (URL(BuildConfig.UPDATE_MANIFEST_URL).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8_000
                readTimeout = 8_000
                requestMethod = "GET"
            }
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val json = JSONObject(text)
            val remoteCode = json.getInt("versionCode")
            val localCode = BuildConfig.VERSION_CODE
            UpdateInfo(
                updateAvailable = remoteCode > localCode,
                remoteVersionCode = remoteCode,
                remoteVersionName = json.optString("versionName", remoteCode.toString()),
                apkUrl = json.getString("url"),
                sha256 = json.getString("sha256").lowercase().replace(":", "")
            )
        } catch (e: Exception) {
            Log.i(TAG, "update check skipped: ${e.message}")
            null
        }
    }

    fun downloadAndPromptInstall(context: Context, info: UpdateInfo): Boolean {
        return try {
            val dir = File(context.cacheDir, "updates").apply { mkdirs() }
            val apk = File(dir, "agent-progress-${info.remoteVersionCode}.apk")
            val conn = (URL(info.apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 120_000
            }
            conn.inputStream.use { input ->
                apk.outputStream().use { output -> input.copyTo(output) }
            }
            conn.disconnect()

            val digest = sha256File(apk)
            if (digest != info.sha256) {
                Log.e(TAG, "sha256 mismatch")
                apk.delete()
                return false
            }

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apk
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "download/install failed: ${e.message}")
            false
        }
    }

    fun sha256Hex(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(bytes).joinToString("") { "%02x".format(it) }
    }

    fun sha256File(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(8192)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
