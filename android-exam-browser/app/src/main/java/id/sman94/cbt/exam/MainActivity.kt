package id.sman94.cbt.exam

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
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
import org.json.JSONTokener

class MainActivity : Activity() {
    private var webView: WebView? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private var authToken: String = ""
    private var activeAttemptId: String = ""
    private var appPausedAt: Long = 0L
    private var cbtBaseUrl: String = ""
    private var cbtApiBaseUrl: String = ""
    private var pendingBaseUrl: String = ""
    private var pendingApiBaseUrl: String = ""
    private var loginExitBar: LinearLayout? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        enterImmersiveMode()
        if (intent?.getBooleanExtra(EXTRA_OVERLAY_PERMISSION_LOST, false) == true) {
            showOverlayPermissionLostScreen()
        } else {
            openConfiguredExamClient()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent?.getBooleanExtra(EXTRA_OVERLAY_PERMISSION_LOST, false) == true) {
            showOverlayPermissionLostScreen()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun onPause() {
        super.onPause()
        appPausedAt = System.currentTimeMillis()
        sendHeartbeat("android_app_hidden", "Aplikasi ujian masuk background atau kehilangan fokus.")
    }

    override fun onResume() {
        super.onResume()
        enterImmersiveMode()
        if (pendingBaseUrl.isNotBlank() && hasOverlayPermission()) {
            val baseUrl = pendingBaseUrl
            val apiBaseUrl = pendingApiBaseUrl
            pendingBaseUrl = ""
            pendingApiBaseUrl = ""
            launchExamClient(baseUrl, apiBaseUrl)
            return
        }
        if (appPausedAt > 0L) {
            val seconds = ((System.currentTimeMillis() - appPausedAt) / 1000).coerceAtLeast(0)
            sendHeartbeat("android_app_resumed", "Peserta kembali ke aplikasi ujian setelah $seconds detik.")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            sendHeartbeat("android_back_blocked", "Tombol back Android ditekan dan diblokir.")
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun configuredBaseUrl(): String {
        return BuildConfig.CBT_BASE_URL.trim().trimEnd('/') + "/"
    }

    private fun configuredApiBaseUrl(): String {
        return BuildConfig.CBT_API_BASE_URL.trim().trimEnd('/')
    }

    private fun openConfiguredExamClient() {
        val baseUrl = configuredBaseUrl()
        val apiBaseUrl = configuredApiBaseUrl()
        if (BuildConfig.REQUIRE_OVERLAY && !hasOverlayPermission()) {
            showOverlayPermissionSetup(baseUrl, apiBaseUrl)
            return
        }
        launchExamClient(baseUrl, apiBaseUrl)
    }

    private fun enterImmersiveMode() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    private fun showOverlayPermissionSetup(baseUrl: String, apiBaseUrl: String) {
        pendingBaseUrl = baseUrl
        pendingApiBaseUrl = apiBaseUrl

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(238, 242, 246))
            setPadding(dp(22), dp(22), dp(22), dp(22))
        }
        val scrollView = ScrollView(this).apply { addView(root) }
        root.addView(TextView(this).apply {
            text = "Izin Appear on Top Dibutuhkan"
            textSize = 25f
            setTextColor(Color.rgb(15, 23, 42))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        })
        root.addView(TextView(this).apply {
            text = "Mode Overlay v2 membutuhkan izin tampil di atas aplikasi lain. Setelah izin aktif, halaman CBT akan berjalan sebagai overlay fullscreen seperti exam client lama."
            textSize = 16f
            setTextColor(Color.rgb(51, 65, 85))
            setPadding(0, dp(12), 0, dp(18))
        })
        root.addView(Button(this).apply {
            text = "Buka Pengaturan Izin"
            textSize = 16f
            setOnClickListener {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            }
        })
        root.addView(Button(this).apply {
            text = "Saya Sudah Mengaktifkan"
            textSize = 16f
            setOnClickListener {
                if (hasOverlayPermission()) {
                    pendingBaseUrl = ""
                    pendingApiBaseUrl = ""
                    launchExamClient(baseUrl, apiBaseUrl)
                } else {
                    Toast.makeText(this@MainActivity, "Izin Appear on top belum aktif.", Toast.LENGTH_LONG).show()
                }
            }
        })
        root.addView(Button(this).apply {
            text = "Coba Lagi"
            textSize = 16f
            setOnClickListener {
                pendingBaseUrl = ""
                pendingApiBaseUrl = ""
                openConfiguredExamClient()
            }
        })
        root.addView(Button(this).apply {
            text = "Keluar Aplikasi"
            textSize = 16f
            setOnClickListener {
                finishAndRemoveTask()
            }
        })
        setContentView(scrollView)
    }

    private fun showOverlayPermissionLostScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(254, 242, 242))
            setPadding(dp(22), dp(22), dp(22), dp(22))
        }
        val scrollView = ScrollView(this).apply { addView(root) }
        root.addView(TextView(this).apply {
            text = "Izin Overlay Dimatikan"
            textSize = 26f
            setTextColor(Color.rgb(127, 29, 29))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        })
        root.addView(TextView(this).apply {
            text = "Sistem mendeteksi izin Appear on top dimatikan saat ujian berlangsung. Kejadian ini sudah dicatat di dashboard monitoring sebagai pelanggaran berat."
            textSize = 16f
            setTextColor(Color.rgb(69, 10, 10))
            setPadding(0, dp(12), 0, dp(18))
        })
        root.addView(Button(this).apply {
            text = "Aktifkan Lagi Izin Overlay"
            textSize = 16f
            setOnClickListener {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            }
        })
        root.addView(Button(this).apply {
            text = "Coba Lagi"
            textSize = 16f
            setOnClickListener {
                openConfiguredExamClient()
            }
        })
        root.addView(Button(this).apply {
            text = "Keluar Aplikasi"
            textSize = 16f
            setOnClickListener {
                finishAndRemoveTask()
            }
        })
        setContentView(scrollView)
    }

    private fun launchExamClient(baseUrl: String, apiBaseUrl: String) {
        if (BuildConfig.REQUIRE_OVERLAY) {
            startOverlayExam(baseUrl, apiBaseUrl)
        } else {
            startExamBrowser(baseUrl, apiBaseUrl)
        }
    }

    private fun startOverlayExam(baseUrl: String, apiBaseUrl: String) {
        val intent = Intent(this, OverlayExamService::class.java).apply {
            putExtra(OverlayExamService.EXTRA_BASE_URL, baseUrl)
            putExtra(OverlayExamService.EXTRA_API_BASE_URL, apiBaseUrl)
        }
        startService(intent)
        showOverlayActiveScreen()
    }

    private fun showOverlayActiveScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(238, 242, 246))
            setPadding(dp(22), dp(22), dp(22), dp(22))
        }
        val scrollView = ScrollView(this).apply { addView(root) }
        root.addView(TextView(this).apply {
            text = "Overlay v2 Aktif"
            textSize = 26f
            setTextColor(Color.rgb(15, 23, 42))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        })
        root.addView(TextView(this).apply {
            text = "Halaman CBT sedang berjalan di overlay fullscreen. Jika tampilan overlay tidak muncul, pastikan izin Appear on top masih aktif."
            textSize = 16f
            setTextColor(Color.rgb(51, 65, 85))
            setPadding(0, dp(12), 0, dp(18))
        })
        root.addView(Button(this).apply {
            text = "Tampilkan Ulang Overlay"
            textSize = 16f
            setOnClickListener {
                startOverlayExam(configuredBaseUrl(), configuredApiBaseUrl())
            }
        })
        setContentView(scrollView)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun startExamBrowser(baseUrl: String, apiBaseUrl: String) {
        cbtBaseUrl = baseUrl
        cbtApiBaseUrl = apiBaseUrl
        authToken = ""
        activeAttemptId = ""

        val browser = WebView(this)
        webView = browser
        browser.setBackgroundColor(Color.rgb(238, 242, 246))
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(238, 242, 246))
        }
        loginExitBar = createLoginExitBar {
            finishAndRemoveTask()
        }
        root.addView(loginExitBar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))
        root.addView(browser, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            4f
        ))
        setContentView(root)

        browser.settings.javaScriptEnabled = true
        browser.settings.domStorageEnabled = true
        browser.settings.databaseEnabled = true
        browser.settings.mediaPlaybackRequiresUserGesture = true
        browser.settings.userAgentString = "${browser.settings.userAgentString} CBT-SMAN94-ExamBrowser/1.0"
        browser.addJavascriptInterface(ExamBridge(), "CBTExamClient")
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return !isAllowedUrl(request.url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                injectExamClientBridge()
            }
        }

        enterImmersiveMode()
        browser.loadUrl(baseUrl)
    }

    private fun createLoginExitBar(onExit: () -> Unit): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(15, 23, 42))
            setPadding(dp(18), dp(18), dp(18), dp(12))
            gravity = android.view.Gravity.CENTER
            addView(TextView(this@MainActivity).apply {
                text = "CBT SMAN 94"
                textSize = 18f
                setTextColor(Color.WHITE)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
            })
            addView(TextView(this@MainActivity).apply {
                text = "Halaman login peserta"
                textSize = 13f
                setTextColor(Color.rgb(203, 213, 225))
                setPadding(0, dp(2), 0, dp(10))
            })
            addView(Button(this@MainActivity).apply {
                text = "Keluar Aplikasi"
                textSize = 16f
                setOnClickListener { onExit() }
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(48)
            ))
        }
    }

    private fun setLoginExitBarVisible(visible: Boolean) {
        mainHandler.post {
            loginExitBar?.visibility = if (visible) View.VISIBLE else View.GONE
        }
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
                  if (!raw) {
                    if (window.CBTExamClient && window.CBTExamClient.setLoginExitVisible) {
                      window.CBTExamClient.setLoginExitVisible(true);
                    }
                    return;
                  }
                  const parsed = JSON.parse(raw);
                  if (parsed && parsed.user && parsed.user.role && parsed.user.role !== "siswa") {
                    localStorage.removeItem("cbt_sman94_session");
                    alert("Aplikasi Android hanya untuk peserta ujian.");
                    window.location.reload();
                    return;
                  }
                  if (parsed && parsed.token && window.CBTExamClient) {
                    window.CBTExamClient.setAuthToken(parsed.token);
                    window.CBTExamClient.setLoginExitVisible(false);
                  }
                } catch (err) {}
              }
              function addAndroidExitButton() {
                try {
                  if (localStorage.getItem("cbt_sman94_session")) return;
                  const panel = document.querySelector(".login-panel");
                  if (!panel || document.getElementById("android-exam-exit-button")) return;
                  const button = document.createElement("button");
                  button.id = "android-exam-exit-button";
                  button.type = "button";
                  button.textContent = "Keluar Aplikasi";
                  button.className = "ghost-button android-exam-exit-button";
                  button.style.marginTop = "12px";
                  button.style.width = "100%";
                  button.addEventListener("click", function() {
                    if (window.CBTExamClient && window.CBTExamClient.exitApp) {
                      window.CBTExamClient.exitApp();
                    }
                  });
                  panel.appendChild(button);
                } catch (err) {}
              }
              function rejectNonStudentLogin(data) {
                try {
                  if (data && data.user && data.user.role && data.user.role !== "siswa") {
                    localStorage.removeItem("cbt_sman94_session");
                    alert("Aplikasi Android hanya untuk peserta ujian. Silakan login dari browser admin/guru.");
                    window.location.reload();
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
                  const originalRemoveItem = Storage.prototype.removeItem;
                  Storage.prototype.removeItem = function(key) {
                    const result = originalRemoveItem.apply(this, arguments);
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
                  if (url.indexOf("/login") !== -1) {
                    response.clone().json().then(rejectNonStudentLogin).catch(function() {});
                  }
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
                    window.CBTExamClient.setLoginExitVisible(true);
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
              try {
                const observer = new MutationObserver(function() { addAndroidExitButton(); });
                observer.observe(document.documentElement, { childList: true, subtree: true });
              } catch (err) {}
              rememberSessionSoon();
              addAndroidExitButton();
            })();
        """.trimIndent()
        webView?.evaluateJavascript(script, null)
    }

    private fun sendHeartbeat(type: String, message: String) {
        val attemptId = activeAttemptId
        val token = authToken
        val apiBaseUrl = cbtApiBaseUrl
        if (token.isBlank() || apiBaseUrl.isBlank()) {
            if (type != "heartbeat") queueClientEvent(type, message, "warning")
            return
        }
        if (attemptId.isBlank()) {
            if (type != "heartbeat") sendClientEvent(type, message, "warning")
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
                val payload = """{"event":"$type","level":"warning","message":"$message"}"""
                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(payload) }
                if (connection.responseCode in 200..299) {
                    connection.inputStream.close()
                } else {
                    connection.errorStream?.close()
                    if (type != "heartbeat") sendClientEvent(type, message, "warning")
                }
                connection.disconnect()
            } catch (_: Exception) {
                if (type != "heartbeat") sendClientEvent(type, message, "warning")
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

    private fun queueClientEvent(type: String, message: String, level: String = "warning") {
        val event = JSONObject()
            .put("clientEventId", createClientEventId())
            .put("event", type)
            .put("level", level)
            .put("message", message)
            .put("attemptId", activeAttemptId)
            .put("clientTime", System.currentTimeMillis())
        queueClientEvent(event)
    }

    private fun queueClientEvent(event: JSONObject) {
        if (event.optString("event") == "heartbeat") return
        val prefs = getSharedPreferences(EVENT_QUEUE_PREFS, MODE_PRIVATE)
        val current = try {
            JSONArray(prefs.getString(EVENT_QUEUE_KEY, "[]") ?: "[]")
        } catch (_: Exception) {
            JSONArray()
        }
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
        val prefs = getSharedPreferences(EVENT_QUEUE_PREFS, MODE_PRIVATE)
        val queuedRaw = prefs.getString(EVENT_QUEUE_KEY, "[]") ?: "[]"
        val queued = try {
            JSONArray(queuedRaw)
        } catch (_: Exception) {
            JSONArray()
        }
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

    private fun answerQueuePrefs() = getSharedPreferences(ANSWER_QUEUE_PREFS, MODE_PRIVATE)

    private fun answerQueueKey(attemptId: String): String {
        return "answers_$attemptId"
    }

    private fun readAnswerQueue(attemptId: String?): JSONObject {
        val id = attemptId.orEmpty()
        if (id.isBlank()) return JSONObject()
        return try {
            JSONObject(answerQueuePrefs().getString(answerQueueKey(id), "{}") ?: "{}")
        } catch (_: Exception) {
            JSONObject()
        }
    }

    private fun writeAnswerQueue(attemptId: String?, queue: JSONObject) {
        val id = attemptId.orEmpty()
        if (id.isBlank()) return
        answerQueuePrefs().edit().putString(answerQueueKey(id), queue.toString()).apply()
    }

    private fun jsonValueFromString(raw: String?): Any {
        return try {
            JSONTokener(raw ?: "null").nextValue()
        } catch (_: Exception) {
            raw.orEmpty()
        }
    }

    private fun jsonStringFromValue(value: Any?): String {
        return when (value) {
            null, JSONObject.NULL -> "null"
            is JSONObject, is JSONArray -> value.toString()
            is String -> JSONObject.quote(value)
            else -> value.toString()
        }
    }

    private fun putJsonValue(target: JSONObject, key: String, value: Any?) {
        when (value) {
            null -> target.put(key, JSONObject.NULL)
            is Boolean -> target.put(key, value)
            is Int -> target.put(key, value)
            is Long -> target.put(key, value)
            is Double -> target.put(key, value)
            is JSONObject -> target.put(key, value)
            is JSONArray -> target.put(key, value)
            else -> target.put(key, value.toString())
        }
    }

    private fun queueAnswerLocally(attemptId: String?, questionId: String?, answerJson: String?, updatedAt: String?) {
        val id = attemptId.orEmpty()
        val qid = questionId.orEmpty()
        if (id.isBlank() || qid.isBlank()) return
        val queue = readAnswerQueue(id)
        val item = JSONObject()
            .put("answerJson", answerJson ?: "null")
            .put("updatedAt", updatedAt?.toLongOrNull() ?: System.currentTimeMillis())
        queue.put(qid, item)
        writeAnswerQueue(id, queue)
    }

    private fun pendingAnswersForWeb(attemptId: String?): String {
        val queue = readAnswerQueue(attemptId)
        val answers = JSONObject()
        val keys = queue.keys()
        while (keys.hasNext()) {
            val questionId = keys.next()
            val item = queue.optJSONObject(questionId)
            putJsonValue(answers, questionId, jsonValueFromString(item?.optString("answerJson", "null")))
        }
        return answers.toString()
    }

    private fun replaceAnswerQueue(attemptId: String?, answersJson: String?) {
        val id = attemptId.orEmpty()
        if (id.isBlank()) return
        val answers = try {
            JSONObject(answersJson ?: "{}")
        } catch (_: Exception) {
            JSONObject()
        }
        val queue = JSONObject()
        val keys = answers.keys()
        val now = System.currentTimeMillis()
        while (keys.hasNext()) {
            val questionId = keys.next()
            val item = JSONObject()
                .put("answerJson", jsonStringFromValue(answers.opt(questionId)))
                .put("updatedAt", now)
            queue.put(questionId, item)
        }
        writeAnswerQueue(id, queue)
    }

    private fun clearAnswerQueue(attemptId: String?) {
        val id = attemptId.orEmpty()
        if (id.isBlank()) return
        answerQueuePrefs().edit().remove(answerQueueKey(id)).apply()
    }

    private fun hasOverlayPermission(): Boolean {
        return !BuildConfig.REQUIRE_OVERLAY || Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    inner class ExamBridge {
        @JavascriptInterface
        fun setAuthToken(token: String?) {
            authToken = token.orEmpty()
            setLoginExitBarVisible(authToken.isBlank())
            flushQueuedEvents()
        }

        @JavascriptInterface
        fun setLoginExitVisible(visible: Boolean) {
            if (activeAttemptId.isNotBlank() && visible) {
                setLoginExitBarVisible(false)
            } else {
                setLoginExitBarVisible(visible)
            }
        }

        @JavascriptInterface
        fun setActiveAttempt(attemptId: String?) {
            activeAttemptId = attemptId.orEmpty()
            setLoginExitBarVisible(activeAttemptId.isBlank() && authToken.isBlank())
            flushQueuedEvents()
        }

        @JavascriptInterface
        fun clearActiveAttempt() {
            activeAttemptId = ""
            setLoginExitBarVisible(authToken.isBlank())
        }

        @JavascriptInterface
        fun savePendingAnswer(attemptId: String?, questionId: String?, answerJson: String?, updatedAt: String?) {
            queueAnswerLocally(attemptId, questionId, answerJson, updatedAt)
        }

        @JavascriptInterface
        fun getPendingAnswers(attemptId: String?): String {
            return pendingAnswersForWeb(attemptId)
        }

        @JavascriptInterface
        fun replacePendingAnswers(attemptId: String?, answersJson: String?) {
            replaceAnswerQueue(attemptId, answersJson)
        }

        @JavascriptInterface
        fun clearPendingAnswers(attemptId: String?) {
            clearAnswerQueue(attemptId)
        }

        @JavascriptInterface
        fun exitApp() {
            if (activeAttemptId.isNotBlank()) {
                sendHeartbeat("android_exit_blocked", "Tombol keluar aplikasi ditekan saat ujian masih aktif dan diblokir.")
                mainHandler.post {
                    Toast.makeText(this@MainActivity, "Selesaikan atau logout ujian terlebih dahulu.", Toast.LENGTH_LONG).show()
                }
                return
            }
            mainHandler.post {
                finishAndRemoveTask()
            }
        }
    }

    companion object {
        const val EXTRA_OVERLAY_PERMISSION_LOST = "overlayPermissionLost"
        private const val ANSWER_QUEUE_PREFS = "cbt_exam_browser_answer_queue"
        private const val EVENT_QUEUE_PREFS = "cbt_exam_browser_event_queue"
        private const val EVENT_QUEUE_KEY = "events"
        private const val MAX_QUEUED_EVENTS = 200
    }
}
