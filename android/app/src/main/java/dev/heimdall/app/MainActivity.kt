package dev.heimdall.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Heimdall for Android: the same UI as the web app (bundled from the web build into assets/web),
 * with native Firebase AI Logic (on-device Gemini Nano + cloud), App Check, speech and haptics
 * through [Bridge].
 */
class MainActivity : ComponentActivity() {
    companion object {
        /**
         * The bundled files are served under the web app's own origin, so Firebase API-key referrer
         * rules and authorized domains match. Requests to this host never reach the network.
         */
        const val HOST = "heimdall-50c68.web.app"
    }

    private lateinit var web: WebView
    private lateinit var bridge: Bridge

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        fileCallback = null
    }

    private val permissionMutex = Mutex()
    private var permissionResult: CompletableDeferred<Boolean>? = null
    private val requestPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        permissionResult?.complete(it)
    }

    suspend fun ensurePermission(permission: String): Boolean = permissionMutex.withLock {
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) return true
        val result = CompletableDeferred<Boolean>()
        permissionResult = result
        requestPermission.launch(permission)
        result.await()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        // Same as the web app's --bg, so the system bar areas blend in.
        val background = if (dark) 0xFF1A1D20.toInt() else 0xFFF8F9FA.toInt()

        web = WebView(this).apply {
            setBackgroundColor(background)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(background)
            addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)

        val assets = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/", WebAssets(this))
            .build()

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            /** Only Heimdall itself runs in the app; any other link opens in the browser. */
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
                if (request.origin.host != HOST || !wantsCamera) {
                    request.deny()
                    return
                }
                lifecycleScope.launch {
                    if (ensurePermission(Manifest.permission.CAMERA)) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    else request.deny()
                }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                pickImage.launch("image/*")
                return true
            }
        }

        bridge = Bridge(this, web)
        web.addJavascriptInterface(bridge, "HeimdallAndroid")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Back closes the Settings sheet first, like the web app's Done button.
                web.evaluateJavascript(
                    "(function(){var b=document.querySelector('[aria-label=\"Close settings\"]');if(b){b.click();return true}return false})()",
                ) { closed ->
                    if (closed != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        if (savedInstanceState == null) web.loadUrl("https://$HOST/") else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        bridge.stopSpeaking()
    }

    override fun onDestroy() {
        bridge.destroy()
        web.destroy()
        super.onDestroy()
    }
}

/** Serves the bundled web build (assets/web); unknown paths get index.html, like Firebase Hosting's rewrite. */
private class WebAssets(private val activity: ComponentActivity) : WebViewAssetLoader.PathHandler {
    private val types = mapOf(
        "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
        "json" to "application/json", "webmanifest" to "application/manifest+json", "svg" to "image/svg+xml",
        "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "webp" to "image/webp", "ico" to "image/x-icon",
        "woff" to "font/woff", "woff2" to "font/woff2", "ttf" to "font/ttf", "txt" to "text/plain",
    )

    override fun handle(path: String): WebResourceResponse {
        val file = path.trimStart('/').takeIf { it.isNotEmpty() && exists("web/$it") } ?: "index.html"
        val type = types[file.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"
        val encoding = if (type.startsWith("text/") || type.contains("json") || type.contains("svg")) "utf-8" else null
        return WebResourceResponse(type, encoding, activity.assets.open("web/$file"))
    }

    private fun exists(asset: String) = runCatching { activity.assets.open(asset).close() }.isSuccess
}
