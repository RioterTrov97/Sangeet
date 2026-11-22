package expo.modules.streamproxy

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/** Headless host for the YouTube extractor page (youtubei.js + BotGuard). The page posts via `window.ReactNativeWebView.postMessage`. */
class ExtractorWebView {
  var onMessage: ((String) -> Unit)? = null
  var onReset: ((String) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())
  private var webView: WebView? = null
  private var ctx: Context? = null
  private var html = ""
  private var baseUrl = ""

  private inner class Bridge {
    @JavascriptInterface
    fun postMessage(message: String) {
      onMessage?.invoke(message)
    }
  }

  fun load(context: Context, html: String, baseUrl: String) {
    main.post {
      this.ctx = context
      this.html = html
      this.baseUrl = baseUrl
      create()
    }
  }

  fun evaluate(js: String) {
    main.post { webView?.evaluateJavascript(js, null) }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun create() {
    val c = ctx ?: return
    webView?.let {
      it.stopLoading()
      it.destroy()
    }
    val view = WebView(c)
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    }
    view.addJavascriptInterface(Bridge(), "ReactNativeWebView")
    view.webViewClient = object : WebViewClient() {
      override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
        Log.w("StreamProxy", "extractor render process gone")
        onReset?.invoke("Extractor web process terminated")
        main.post { create() }
        return true
      }
    }
    // Lay the view out at a real size so Chromium does not treat it as hidden and throttle timers.
    view.measure(1, 1)
    view.layout(0, 0, 1, 1)
    webView = view
    onReset?.invoke("Extractor reloading")
    view.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
  }
}
