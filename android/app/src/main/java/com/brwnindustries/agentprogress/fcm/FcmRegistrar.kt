package com.brwnindustries.agentprogress.fcm

import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import com.brwnindustries.agentprogress.BuildConfig
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume

object FcmRegistrar {
    private const val TAG = "FcmRegistrar"
    private const val PREFS = "ap_fcm"
    private const val KEY_TOKEN = "token"
    private const val KEY_WORKSPACE = "workspace_id"

    suspend fun refreshAndRegister(context: Context, workspaceId: String? = null) {
        val token = fetchToken() ?: return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TOKEN, token)
            .apply {
                if (!workspaceId.isNullOrBlank()) putString(KEY_WORKSPACE, workspaceId)
            }
            .apply()
        registerToken(context, token, workspaceId)
    }

    suspend fun registerToken(context: Context, token: String, workspaceId: String? = null) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ws = workspaceId ?: prefs.getString(KEY_WORKSPACE, null)
        if (ws.isNullOrBlank()) {
            Log.i(TAG, "FCM token ready; waiting for workspace id from web UI")
            prefs.edit().putString(KEY_TOKEN, token).apply()
            return
        }
        prefs.edit().putString(KEY_TOKEN, token).putString(KEY_WORKSPACE, ws).apply()

        val cookie = CookieManager.getInstance().getCookie(BuildConfig.API_ORIGIN) ?: ""
        val body = JSONObject()
            .put("workspaceId", ws)
            .put("token", token)
            .put("platform", "android")
            .toString()

        try {
            val conn = (URL("${BuildConfig.API_ORIGIN.trimEnd('/')}/api/push/fcm/register").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
                if (cookie.isNotBlank()) setRequestProperty("Cookie", cookie)
                connectTimeout = 10_000
                readTimeout = 10_000
            }
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code !in 200..299) {
                Log.w(TAG, "FCM register HTTP $code")
            } else {
                Log.i(TAG, "FCM token registered for workspace")
            }
            conn.disconnect()
        } catch (e: Exception) {
            Log.w(TAG, "FCM register failed: ${e.message}")
        }
    }

    private suspend fun fetchToken(): String? = suspendCancellableCoroutine { cont ->
        try {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token -> cont.resume(token) }
                .addOnFailureListener { e ->
                    Log.w(TAG, "FCM token fetch failed: ${e.message}")
                    cont.resume(null)
                }
        } catch (e: Exception) {
            Log.w(TAG, "FCM unavailable: ${e.message}")
            cont.resume(null)
        }
    }
}
