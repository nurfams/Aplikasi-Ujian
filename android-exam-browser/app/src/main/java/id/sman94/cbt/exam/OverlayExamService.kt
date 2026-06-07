package id.sman94.cbt.exam

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

class OverlayExamService : Service() {
    private var windowManager: WindowManager? = null
    private var webView: WebView? = null
    private var params: WindowManager.LayoutParams? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private var cbtBaseUrl: String = ""
    private var cbtApiBaseUrl: String = ""
    private var authToken: String = ""
    private var activeAttemptId: String = ""
    private var overlayPermissionLostReported = false
    private var overlayFocusLostReported = false
    private var normalStop = false
    private var lastNativeHeartbeatAt = 0L
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val watchdogRunnable = object : Runnable {
        override fun run() {
            runWatchdogTick()
            mainHandler.postDelayed(this, WATCHDOG_INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val baseUrl = intent?.getStringExtra(EXTRA_BASE_URL).orEmpty()
        val apiBaseUrl = intent?.getStringExtra(EXTRA_API_BASE_URL).orEmpty()
        if (baseUrl.isBlank() || apiBaseUrl.isBlank() || !canDrawOverlay()) {
            stopSelf()
            return START_NOT_STICKY
        }
        cbtBaseUrl = baseUrl
        cbtApiBaseUrl = apiBaseUrl
        startExamForeground()
        showExamOverlay()
        registerNetworkWatcher()
        mainHandler.removeCallbacks(watchdogRunnable)
        mainHandler.postDelayed(watchdogRunnable, WATCHDOG_INTERVAL_MS)
        return START_STICKY
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(watchdogRunnable)
        unregisterNetworkWatcher()
        if (activeAttemptId.isNotBlank() && !normalStop) {
            sendHeartbeat(
                "overlay_service_destroyed",
                "Service overlay berhenti saat ujian masih aktif.",
                "critical"
            )
        }
        removeOverlay()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showExamOverlay() {
        if (webView != null) return

        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val browser = WebView(this)
        webView = browser
        browser.setBackgroundColor(Color.rgb(238, 242, 246))
        browser.isFocusable = true
        browser.isFocusableInTouchMode = true
        browser.requestFocus()
        browser.setOnFocusChangeListener { _, hasFocus ->
            if (!hasFocus && activeAttemptId.isNotBlank()) {
                reportOverlayFocusLost()
            }
        }
        browser.settings.javaScriptEnabled = true
        browser.settings.domStorageEnabled = true
        browser.settings.databaseEnabled = true
        browser.settings.mediaPlaybackRequiresUserGesture = true
        browser.settings.userAgentString = "${browser.settings.userAgentString} CBT-SMAN94-ExamBrowser/1.0 OverlayV2"
        browser.addJavascriptInterface(OverlayBridge(), "CBTExamClient")
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return !isAllowedUrl(request.url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                injectExamClientBridge()
            }
        }

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            0,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
        }

        windowManager?.addView(browser, params)
        browser.loadUrl(cbtBaseUrl)
    }

    private fun startExamForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                FOREGROUND_CHANNEL_ID,
                "CBT Exam Browser",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Menjaga Exam Browser tetap aktif selama ujian."
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }

        val openIntent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, FOREGROUND_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val notification = builder
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("CBT SMAN 94 sedang ujian")
            .setContentText("Exam Browser aktif. Jangan keluar atau mematikan izin overlay.")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
        startForeground(FOREGROUND_NOTIFICATION_ID, notification)
    }

    private fun isAllowedUrl(uri: Uri): Boolean {
        val scheme = uri.scheme.orEmpty().lowercase()
        val host = uri.host.orEmpty()
        val allowedHosts = setOf(
            Uri.parse(cbtBaseUrl).host.orEmpty(),
            Uri.parse(cbtApiBaseUrl).host.orEmpty()
        ).filter { it.isNotBlank() }.toSet()
        return (scheme == "http" || scheme == "https") && allowedHosts.contains(host)
    }

    private fun injectExamClientBridge() {
        val apiBaseUrl = cbtApiBaseUrl
        val script = """
            (function() {
              if (window.__CBT_EXAM_CLIENT_PATCHED__) return;
              window.__CBT_EXAM_CLIENT_PATCHED__ = true;
              const apiBaseUrl = "$apiBaseUrl";
              const clientHeaders = {
                "x-cbt-exam-client": "${BuildConfig.EXAM_CLIENT_ID}",
                "x-cbt-exam-client-key": "${BuildConfig.EXAM_CLIENT_KEY}"
              };
              function rememberSession() {
                try {
                  const raw = localStorage.getItem("cbt_sman94_session");
                  if (!raw) return;
                  const parsed = JSON.parse(raw);
                  if (parsed && parsed.token && window.CBTExamClient) {
                    window.CBTExamClient.setAuthToken(parsed.token);
                  }
                } catch (err) {}
              }
              function rememberSessionSoon() {
                setTimeout(rememberSession, 0);
                setTimeout(rememberSession, 250);
                setTimeout(rememberSession, 1000);
              }
              try {
                const originalSetItem = Storage.prototype.setItem;
                if (!window.__CBT_STORAGE_PATCHED__) {
                  window.__CBT_STORAGE_PATCHED__ = true;
                  Storage.prototype.setItem = function(key, value) {
                    const result = originalSetItem.apply(this, arguments);
                    if (key === "cbt_sman94_session") rememberSessionSoon();
                    return result;
                  };
                }
              } catch (err) {}
              const originalFetch = window.fetch;
              window.fetch = async function(input, init) {
                init = init || {};
                const url = (typeof input === "string") ? input : (input && input.url) || "";
                if (url.indexOf("/api/") !== -1 || (apiBaseUrl && url.indexOf(apiBaseUrl) !== -1)) {
                  init.headers = Object.assign({}, init.headers || {}, clientHeaders);
                }
                const response = await originalFetch(input, init);
                try {
                  rememberSessionSoon();
                  if (url.indexOf("/attempts/start") !== -1) {
                    response.clone().json().then(function(data) {
                      if (data && data.attempt && data.attempt.id && window.CBTExamClient) {
                        window.CBTExamClient.setActiveAttempt(data.attempt.id);
                      }
                    }).catch(function() {});
                  }
                  if (url.indexOf("/submit") !== -1 && window.CBTExamClient) {
                    window.CBTExamClient.clearActiveAttempt();
                  }
                  if (url.indexOf("/logout") !== -1 && window.CBTExamClient) {
                    window.CBTExamClient.closeOverlay();
                  }
                } catch (err) {}
                return response;
              };
              const OriginalXHR = window.XMLHttpRequest;
              window.XMLHttpRequest = function() {
                const xhr = new OriginalXHR();
                const open = xhr.open;
                xhr.open = function(method, url) {
                  this.__cbt_url = url || "";
                  return open.apply(this, arguments);
                };
                const send = xhr.send;
                xhr.send = function() {
                  try {
                    if ((this.__cbt_url || "").indexOf("/api/") !== -1 || (apiBaseUrl && (this.__cbt_url || "").indexOf(apiBaseUrl) !== -1)) {
                      this.setRequestHeader("x-cbt-exam-client", "${BuildConfig.EXAM_CLIENT_ID}");
                      this.setRequestHeader("x-cbt-exam-client-key", "${BuildConfig.EXAM_CLIENT_KEY}");
                    }
                  } catch (err) {}
                  return send.apply(this, arguments);
                };
                return xhr;
              };
              document.addEventListener("contextmenu", function(event) { event.preventDefault(); }, true);
              document.addEventListener("selectstart", function(event) { event.preventDefault(); }, true);
              rememberSessionSoon();
            })();
        """.trimIndent()
        webView?.evaluateJavascript(script, null)
    }

    private fun runWatchdogTick() {
        if (!canDrawOverlay()) {
            reportOverlayPermissionLost()
            return
        }

        if (activeAttemptId.isBlank()) return

        if (webView?.hasFocus() == false || webView?.hasWindowFocus() == false) {
            reportOverlayFocusLost()
        } else {
            overlayFocusLostReported = false
        }

        val now = System.currentTimeMillis()
        if (now - lastNativeHeartbeatAt >= NATIVE_HEARTBEAT_INTERVAL_MS) {
            lastNativeHeartbeatAt = now
            sendHeartbeat("heartbeat", "Overlay native heartbeat aktif.", "info")
        }
    }

    private fun reportOverlayPermissionLost() {
        if (overlayPermissionLostReported) return
        overlayPermissionLostReported = true
        sendHeartbeat(
            "overlay_permission_revoked",
            "Izin Appear on top dimatikan saat ujian berlangsung.",
            "critical"
        )
        openPermissionLostScreen()
        normalStop = true
        stopSelf()
    }

    private fun reportOverlayFocusLost() {
        if (overlayFocusLostReported) return
        overlayFocusLostReported = true
        sendClientEvent(
            "possible_overlay_focus_lost",
            "Exam overlay kehilangan fokus saat ujian berlangsung. Kemungkinan ada panel/aplikasi lain tampil di atas ujian.",
            "warning"
        )
    }

    private fun registerNetworkWatcher() {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (networkCallback != null) return
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onLost(network: Network) {
                sendClientEvent(
                    "connection_lost",
                    "Koneksi internet pada perangkat peserta terputus saat ujian berlangsung.",
                    "warning"
                )
            }

            override fun onAvailable(network: Network) {
                sendClientEvent(
                    "connection_restored",
                    "Koneksi internet pada perangkat peserta tersambung kembali.",
                    "info"
                )
                flushQueuedEvents()
            }
        }
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        try {
            manager.registerNetworkCallback(request, networkCallback!!)
        } catch (_: Exception) {
        }
    }

    private fun unregisterNetworkWatcher() {
        val callback = networkCallback ?: return
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        try {
            manager.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
        networkCallback = null
    }

    private fun openPermissionLostScreen() {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(MainActivity.EXTRA_OVERLAY_PERMISSION_LOST, true)
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
        }
    }

    private fun sendHeartbeat(type: String, message: String, level: String = "warning") {
        val attemptId = activeAttemptId
        val token = authToken
        val apiBaseUrl = cbtApiBaseUrl
        if (token.isBlank() || apiBaseUrl.isBlank()) return
        if (attemptId.isBlank()) {
            if (type != "heartbeat") sendClientEvent(type, message, level)
            return
        }

        executor.execute {
            try {
                val url = URL("$apiBaseUrl/attempts/$attemptId/heartbeat")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 3000
                    readTimeout = 3000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("x-cbt-exam-client", BuildConfig.EXAM_CLIENT_ID)
                    setRequestProperty("x-cbt-exam-client-key", BuildConfig.EXAM_CLIENT_KEY)
                }
                val payload = JSONObject()
                    .put("event", type)
                    .put("level", level)
                    .put("message", message)
                    .toString()
                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(payload) }
                if (connection.responseCode in 200..299) {
                    connection.inputStream.close()
                } else {
                    connection.errorStream?.close()
                    if (type != "heartbeat") sendClientEvent(type, message, level)
                }
                connection.disconnect()
            } catch (_: Exception) {
                if (type != "heartbeat") sendClientEvent(type, message, level)
            }
        }
    }

    private fun sendClientEvent(type: String, message: String, level: String = "warning") {
        val token = authToken
        val apiBaseUrl = cbtApiBaseUrl
        val event = JSONObject()
            .put("clientEventId", createClientEventId())
            .put("event", type)
            .put("level", level)
            .put("message", message)
            .put("attemptId", activeAttemptId)
            .put("clientTime", System.currentTimeMillis())
        if (token.isBlank() || apiBaseUrl.isBlank()) {
            queueClientEvent(event)
            return
        }

        executor.execute {
            try {
                val url = URL("$apiBaseUrl/client-events")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 3000
                    readTimeout = 3000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("x-cbt-exam-client", BuildConfig.EXAM_CLIENT_ID)
                    setRequestProperty("x-cbt-exam-client-key", BuildConfig.EXAM_CLIENT_KEY)
                }
                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(event.toString()) }
                if (connection.responseCode in 200..299) {
                    connection.inputStream.close()
                    flushQueuedEvents()
                } else {
                    connection.errorStream?.close()
                    queueClientEvent(event)
                }
                connection.disconnect()
            } catch (_: Exception) {
                queueClientEvent(event)
            }
        }
    }

    private fun queueClientEvent(event: JSONObject) {
        if (event.optString("event") == "heartbeat") return
        val prefs = getSharedPreferences(EVENT_QUEUE_PREFS, Context.MODE_PRIVATE)
        val current = JSONArray(prefs.getString(EVENT_QUEUE_KEY, "[]") ?: "[]")
        current.put(event)
        val compact = JSONArray()
        val start = (current.length() - MAX_QUEUED_EVENTS).coerceAtLeast(0)
        for (index in start until current.length()) {
            compact.put(current.getJSONObject(index))
        }
        prefs.edit().putString(EVENT_QUEUE_KEY, compact.toString()).apply()
    }

    private fun flushQueuedEvents() {
        val token = authToken
        val apiBaseUrl = cbtApiBaseUrl
        if (token.isBlank() || apiBaseUrl.isBlank()) return
        val prefs = getSharedPreferences(EVENT_QUEUE_PREFS, Context.MODE_PRIVATE)
        val queuedRaw = prefs.getString(EVENT_QUEUE_KEY, "[]") ?: "[]"
        val queued = JSONArray(queuedRaw)
        if (queued.length() == 0) return

        executor.execute {
            try {
                val url = URL("$apiBaseUrl/client-events/batch")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 3000
                    readTimeout = 5000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("x-cbt-exam-client", BuildConfig.EXAM_CLIENT_ID)
                    setRequestProperty("x-cbt-exam-client-key", BuildConfig.EXAM_CLIENT_KEY)
                }
                val payload = JSONObject().put("events", queued).toString()
                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(payload) }
                if (connection.responseCode in 200..299) {
                    connection.inputStream.close()
                    prefs.edit().remove(EVENT_QUEUE_KEY).apply()
                } else {
                    connection.errorStream?.close()
                }
                connection.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private fun createClientEventId(): String {
        return "android-${System.currentTimeMillis()}-${(1000..9999).random()}"
    }

    private fun removeOverlay() {
        webView?.let { view ->
            try {
                windowManager?.removeView(view)
            } catch (_: Exception) {
            }
            view.removeAllViews()
            view.destroy()
        }
        webView = null
    }

    private fun canDrawOverlay(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
    }

    inner class OverlayBridge {
        @JavascriptInterface
        fun setAuthToken(token: String?) {
            authToken = token.orEmpty()
            flushQueuedEvents()
        }

        @JavascriptInterface
        fun setActiveAttempt(attemptId: String?) {
            activeAttemptId = attemptId.orEmpty()
            overlayPermissionLostReported = false
            lastNativeHeartbeatAt = 0L
            flushQueuedEvents()
            sendHeartbeat("overlay_exam_started", "Mode overlay fullscreen aktif untuk ujian.")
        }

        @JavascriptInterface
        fun clearActiveAttempt() {
            activeAttemptId = ""
            normalStop = true
            stopSelf()
        }

        @JavascriptInterface
        fun closeOverlay() {
            normalStop = true
            stopSelf()
        }
    }

    companion object {
        const val EXTRA_BASE_URL = "baseUrl"
        const val EXTRA_API_BASE_URL = "apiBaseUrl"
        private const val WATCHDOG_INTERVAL_MS = 1000L
        private const val NATIVE_HEARTBEAT_INTERVAL_MS = 5000L
        private const val FOREGROUND_CHANNEL_ID = "cbt_exam_browser"
        private const val FOREGROUND_NOTIFICATION_ID = 94
        private const val EVENT_QUEUE_PREFS = "cbt_exam_browser_event_queue"
        private const val EVENT_QUEUE_KEY = "events"
        private const val MAX_QUEUED_EVENTS = 200
    }
}
