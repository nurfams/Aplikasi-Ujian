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
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
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

    private val settings by lazy {
        getSharedPreferences("cbt_exam_browser_settings", MODE_PRIVATE)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        enterImmersiveMode()
        if (intent?.getBooleanExtra(EXTRA_OVERLAY_PERMISSION_LOST, false) == true) {
            showOverlayPermissionLostScreen()
        } else {
            showServerSetup()
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

    private fun showServerSetup() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(238, 242, 246))
            setPadding(dp(22), dp(22), dp(22), dp(22))
        }
        val scrollView = ScrollView(this).apply {
            addView(root)
        }

        root.addView(TextView(this).apply {
            text = "CBT SMAN 94"
            textSize = 28f
            setTextColor(Color.rgb(15, 23, 42))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        })
        root.addView(TextView(this).apply {
            text = "Setting Server Uji Coba - Mode ${BuildConfig.SECURITY_MODE_LABEL}"
            textSize = 18f
            setTextColor(Color.rgb(71, 85, 105))
            setPadding(0, dp(4), 0, dp(18))
        })

        root.addView(TextView(this).apply {
            text = "Isi IP laptop/server yang sedang menjalankan web CBT. Contoh: 192.168.1.3"
            textSize = 15f
            setTextColor(Color.rgb(51, 65, 85))
            setPadding(0, 0, 0, dp(18))
        })

        val savedHost = settings.getString("server_host", "") ?: ""
        val savedWebPort = settings.getString("web_port", "5173") ?: "5173"
        val savedApiPort = settings.getString("api_port", "4100") ?: "4100"
        val hostInput = createInput("IP laptop/server", if (savedHost.isNotBlank()) savedHost else "")
        val webPortInput = createInput("Port web", savedWebPort, InputType.TYPE_CLASS_NUMBER)
        val apiPortInput = createInput("Port API", savedApiPort, InputType.TYPE_CLASS_NUMBER)

        root.addView(createLabel("Alamat IP / URL Server"))
        root.addView(hostInput)
        root.addView(createLabel("Port Web"))
        root.addView(webPortInput)
        root.addView(createLabel("Port API"))
        root.addView(apiPortInput)

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(18), 0, 0)
        }
        buttonRow.addView(Button(this).apply {
            text = "Simpan & Masuk Ujian"
            textSize = 16f
            setOnClickListener {
                val config = buildServerConfig(
                    hostInput.text.toString(),
                    webPortInput.text.toString(),
                    apiPortInput.text.toString()
                )
                if (config == null) {
                    Toast.makeText(this@MainActivity, "Alamat server belum benar.", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                settings.edit()
                    .putString("server_host", config.hostLabel)
                    .putString("web_port", config.webPort.toString())
                    .putString("api_port", config.apiPort.toString())
                    .apply()
                if (BuildConfig.REQUIRE_OVERLAY && !hasOverlayPermission()) {
                    showOverlayPermissionSetup(config.baseUrl, config.apiBaseUrl)
                    return@setOnClickListener
                }
                launchExamClient(config.baseUrl, config.apiBaseUrl)
            }
        })
        buttonRow.addView(Button(this).apply {
            text = "Reset Form"
            textSize = 16f
            setOnClickListener {
                hostInput.setText("")
                webPortInput.setText("5173")
                apiPortInput.setText("4100")
            }
        })
        root.addView(buttonRow)

        setContentView(scrollView)
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
            text = "Kembali ke Setting Server"
            textSize = 16f
            setOnClickListener {
                pendingBaseUrl = ""
                pendingApiBaseUrl = ""
                showServerSetup()
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
            text = "Kembali ke Setting Server"
            textSize = 16f
            setOnClickListener {
                showServerSetup()
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
                val savedHost = settings.getString("server_host", "").orEmpty()
                val savedWebPort = settings.getString("web_port", "5173").orEmpty()
                val savedApiPort = settings.getString("api_port", "4100").orEmpty()
                val config = buildServerConfig(savedHost, savedWebPort, savedApiPort)
                if (config != null) startOverlayExam(config.baseUrl, config.apiBaseUrl)
            }
        })
        root.addView(Button(this).apply {
            text = "Kembali ke Setting Server"
            textSize = 16f
            setOnClickListener {
                stopService(Intent(this@MainActivity, OverlayExamService::class.java))
                showServerSetup()
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
        setContentView(browser)

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

    private fun sendHeartbeat(type: String, message: String) {
        val attemptId = activeAttemptId
        val token = authToken
        val apiBaseUrl = cbtApiBaseUrl
        if (attemptId.isBlank() || token.isBlank() || apiBaseUrl.isBlank()) return

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
                connection.inputStream.close()
                connection.disconnect()
            } catch (_: Exception) {
                // Security logs should never crash the exam client.
            }
        }
    }

    private fun hasOverlayPermission(): Boolean {
        return !BuildConfig.REQUIRE_OVERLAY || Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
    }

    private fun createLabel(textValue: String): TextView {
        return TextView(this).apply {
            text = textValue
            textSize = 14f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.rgb(30, 41, 59))
            setPadding(0, dp(10), 0, dp(6))
        }
    }

    private fun createInput(hintValue: String, value: String, inputTypeValue: Int = InputType.TYPE_CLASS_TEXT): EditText {
        return EditText(this).apply {
            hint = hintValue
            setText(value)
            setSingleLine(true)
            inputType = inputTypeValue
            textSize = 16f
            setPadding(dp(14), 0, dp(14), 0)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(54)
            )
        }
    }

    private fun buildServerConfig(rawHost: String, rawWebPort: String, rawApiPort: String): ServerConfig? {
        val apiPort = rawApiPort.trim().toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
        var webPort = rawWebPort.trim().toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
        var hostLabel = rawHost.trim().trimEnd('/')
        if (hostLabel.isBlank()) return null

        if (hostLabel.startsWith("http://") || hostLabel.startsWith("https://")) {
            val parsed = Uri.parse(hostLabel)
            val scheme = parsed.scheme ?: "http"
            val host = parsed.host ?: return null
            if (parsed.port > 0) webPort = parsed.port
            hostLabel = host
            return ServerConfig(
                hostLabel = hostLabel,
                webPort = webPort,
                apiPort = apiPort,
                baseUrl = "$scheme://$host:$webPort/",
                apiBaseUrl = "$scheme://$host:$apiPort/api"
            )
        }

        hostLabel = hostLabel.substringBefore("/")
        if (hostLabel.contains(":")) {
            val parts = hostLabel.split(":", limit = 2)
            hostLabel = parts[0]
            webPort = parts.getOrNull(1)?.toIntOrNull()?.takeIf { it in 1..65535 } ?: webPort
        }
        if (hostLabel.isBlank()) return null
        return ServerConfig(
            hostLabel = hostLabel,
            webPort = webPort,
            apiPort = apiPort,
            baseUrl = "http://$hostLabel:$webPort/",
            apiBaseUrl = "http://$hostLabel:$apiPort/api"
        )
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    data class ServerConfig(
        val hostLabel: String,
        val webPort: Int,
        val apiPort: Int,
        val baseUrl: String,
        val apiBaseUrl: String
    )

    inner class ExamBridge {
        @JavascriptInterface
        fun setAuthToken(token: String?) {
            authToken = token.orEmpty()
        }

        @JavascriptInterface
        fun setActiveAttempt(attemptId: String?) {
            activeAttemptId = attemptId.orEmpty()
        }

        @JavascriptInterface
        fun clearActiveAttempt() {
            activeAttemptId = ""
        }
    }

    companion object {
        const val EXTRA_OVERLAY_PERMISSION_LOST = "overlayPermissionLost"
    }
}
