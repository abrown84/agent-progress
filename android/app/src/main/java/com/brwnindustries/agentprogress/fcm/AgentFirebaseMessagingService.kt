package com.brwnindustries.agentprogress.fcm

import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.brwnindustries.agentprogress.BuildConfig
import com.brwnindustries.agentprogress.MainActivity
import com.brwnindustries.agentprogress.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AgentFirebaseMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        scope.launch {
            FcmRegistrar.registerToken(applicationContext, token)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.data["title"]
            ?: message.notification?.title
            ?: getString(R.string.app_name)
        val body = message.data["body"]
            ?: message.notification?.body
            ?: ""
        val path = message.data["url"] ?: "/#/dashboard"
        val tag = message.data["tag"] ?: "agent-progress"
        val openUrl = if (path.startsWith("http")) path else BuildConfig.API_ORIGIN.trimEnd('/') + path

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_OPEN_URL, openUrl)
        }
        val pi = PendingIntent.getActivity(
            this,
            tag.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(
            this,
            getString(R.string.default_notification_channel_id)
        )
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pi)
            .build()

        try {
            NotificationManagerCompat.from(this).notify(tag.hashCode(), notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "notify blocked: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "AgentFCM"
    }
}
