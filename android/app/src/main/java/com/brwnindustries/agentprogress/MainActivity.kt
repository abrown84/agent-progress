package com.brwnindustries.agentprogress

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.brwnindustries.agentprogress.fcm.FcmRegistrar
import com.brwnindustries.agentprogress.update.UpdateChecker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var pendingDeepLink: String? = null

    private val notifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                lifecycleScope.launch { FcmRegistrar.refreshAndRegister(this@MainActivity) }
            } else {
                Toast.makeText(this, R.string.notifications_denied, Toast.LENGTH_LONG).show()
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_AgentProgress)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview)

        pendingDeepLink = intent?.data?.toString()
            ?: intent?.getStringExtra(EXTRA_OPEN_URL)

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString AgentProgressNative/2.0"
            mediaPlaybackRequiresUserGesture = true
        }
        webView.addJavascriptInterface(NativeBridge(), "AgentProgressNative")
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                return if (url.host == "progress.brwnindustries.com" || url.host == null) {
                    false
                } else {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                injectNativeFlag()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                injectNativeFlag()
                CookieManager.getInstance().flush()
            }
        }

        val start = pendingDeepLink ?: BuildConfig.LAUNCHER_URL
        webView.loadUrl(start)
        pendingDeepLink = null

        maybeRequestNotifications()
        lifecycleScope.launch {
            checkForUpdate()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = intent.data?.toString() ?: intent.getStringExtra(EXTRA_OPEN_URL)
        if (!url.isNullOrBlank()) {
            webView.loadUrl(url)
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun injectNativeFlag() {
        webView.evaluateJavascript(
            """
            (function(){
              window.AgentProgressNativeApp = {
                platform: 'android',
                versionCode: ${BuildConfig.VERSION_CODE},
                versionName: '${BuildConfig.VERSION_NAME}',
                fcm: true
              };
              window.dispatchEvent(new Event('agent-progress-native-ready'));
            })();
            """.trimIndent(),
            null
        )
    }

    private fun maybeRequestNotifications() {
        if (Build.VERSION.SDK_INT >= 33) {
            val ok = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            if (ok != PackageManager.PERMISSION_GRANTED) {
                notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }
        lifecycleScope.launch { FcmRegistrar.refreshAndRegister(this@MainActivity) }
    }

    private suspend fun checkForUpdate() {
        val result = withContext(Dispatchers.IO) {
            UpdateChecker.check(this@MainActivity)
        } ?: return
        if (!result.updateAvailable) return
        withContext(Dispatchers.Main) {
            AlertDialog.Builder(this@MainActivity)
                .setTitle(R.string.update_available_title)
                .setMessage(getString(R.string.update_available_body, result.remoteVersionName))
                .setPositiveButton(R.string.update_install) { _, _ ->
                    lifecycleScope.launch {
                        val ok = withContext(Dispatchers.IO) {
                            UpdateChecker.downloadAndPromptInstall(this@MainActivity, result)
                        }
                        if (!ok) {
                            Toast.makeText(
                                this@MainActivity,
                                R.string.update_failed,
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                }
                .setNegativeButton(R.string.update_later, null)
                .show()
        }
    }

    inner class NativeBridge {
        @JavascriptInterface
        fun enableNotifications() {
            runOnUiThread { maybeRequestNotifications() }
        }

        @JavascriptInterface
        fun registerFcm(workspaceId: String) {
            lifecycleScope.launch {
                FcmRegistrar.refreshAndRegister(this@MainActivity, workspaceId.ifBlank { null })
            }
        }

        @JavascriptInterface
        fun getVersionCode(): Int = BuildConfig.VERSION_CODE

        @JavascriptInterface
        fun isNative(): Boolean = true
    }

    companion object {
        const val EXTRA_OPEN_URL = "open_url"
    }
}
