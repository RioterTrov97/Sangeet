package expo.modules.streamproxy

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android twin of the iOS StreamProxy module: same JS contract (see modules/stream-proxy/index.ts).
 *  - a 127.0.0.1 HTTP range proxy that lazily asks JS to resolve a videoId into a googlevideo URL
 *  - a headless android.webkit.WebView hosting the extractor page
 * Not implemented on Android (the TV app has no downloads): HLS routes, background downloads.
 */
class StreamProxyModule : Module() {
  private val server = ProxyServer()
  private val extractor = ExtractorWebView()
  /** Cache budget set by JS before the proxy starts (default 1 GB). */
  private var pendingCap = CACHE_BYTES
  /** Dev "force offline" flag from JS; the Android fetch logic does not read it. */
  @Volatile private var simulateOffline = false

  private fun num(m: Map<String, Any?>, k: String, def: Long = -1): Long = (m[k] as? Number)?.toLong() ?: def

  override fun definition() = ModuleDefinition {
    Name("StreamProxy")
    Events("onSongCached", "onResolveRequest", "onExtractorMessage", "onExtractorReset", "onDownloadProgress", "onDownloadDone", "onDownloadFailed")

    OnCreate {
      server.onResolveRequest = { videoId, requestId, refresh ->
        sendEvent("onResolveRequest", mapOf("videoId" to videoId, "requestId" to requestId, "refresh" to refresh))
      }
      server.onCached = { id -> sendEvent("onSongCached", mapOf("id" to id)) }
      extractor.onMessage = { data -> sendEvent("onExtractorMessage", mapOf("data" to data)) }
      extractor.onReset = { reason -> sendEvent("onExtractorReset", mapOf("reason" to reason)) }
    }

    OnDestroy { server.stop() }

    Function("extractorLoad") { html: String, baseUrl: String ->
      extractor.load(appContext.reactContext!!.applicationContext, html, baseUrl)
    }

    // Songs from this phone exist on iOS only; the TV never calls this.
    AsyncFunction("readAudioTags") { _: String, _: String -> mapOf("hasArtwork" to false) }

    Function("setSimulateOffline") { on: Boolean -> simulateOffline = on }

    Function("extractorEval") { js: String -> extractor.evaluate(js) }

    AsyncFunction("start") { ->
      appContext.reactContext?.applicationContext?.let { server.initCache(java.io.File(it.cacheDir, "songs"), pendingCap) }
      server.start()
    }

    // Budget for background song downloads in bytes (0 = off). Finished songs are ranked and trimmed by JS.
    Function("cacheConfigure") { bytes: Double ->
      server.cache?.capBytes = bytes.toLong()
      pendingCap = bytes.toLong()
    }

    // Every finished song: [{id, bytes, lastUsed}].
    Function("cacheList") {
      server.cache?.list()?.map { mapOf("id" to it.first, "bytes" to it.second, "lastUsed" to it.third) } ?: emptyList<Map<String, Any>>()
    }
    Function("cacheDelete") { id: String -> server.cache?.delete(id) }
    Function("cacheClear") { -> server.cache?.clear() }

    // The fully downloaded copy of a song in the background cache, if any ({path, bytes}).
    Function("cacheLookup") { id: String ->
      server.cache?.complete(id)?.let { mapOf("path" to it.absolutePath, "bytes" to it.length()) }
    }

    Function("fulfill") { requestId: String?, videoId: String, info: Map<String, Any?> ->
      val url = info["url"] as? String ?: return@Function
      val stream = ProxyStream(
        url = url,
        length = num(info, "contentLength"),
        mime = info["mimeType"] as? String ?: "audio/mp4",
        userAgent = info["userAgent"] as? String ?: DEFAULT_UA,
        headers = (info["headers"] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value.toString() } ?: emptyMap(),
        expiresAt = num(info, "expiresAt", 0),
        initStart = num(info, "initStart"),
        initEnd = num(info, "initEnd"),
        indexStart = num(info, "indexStart"),
        indexEnd = num(info, "indexEnd"),
        codecs = info["codecs"] as? String ?: "",
        width = num(info, "width", 0),
        height = num(info, "height", 0),
        bitrate = num(info, "bitrate", 0),
        durationMs = num(info, "durationMs", 0),
      )
      if (requestId != null) server.fulfill(requestId, stream) else server.prime(videoId, stream)
    }

    // Tallest frame each video codec family decodes and whether that decoder is hardware (for the adaptive video pick).
    Function("decoderCaps") { -> DecoderCaps.read() }

    Function("reject") { requestId: String, reason: String -> server.reject(requestId, reason) }
    Function("unregister") { id: String -> server.unregister(id) }

    // Downloads are not part of the TV app.
    Function("bgDownloadStart") { _: String, _: Map<String, Any?> -> }
    Function("bgDownloadCancel") { _: String -> }
    Function("bgDownloadStatus") { -> emptyList<Map<String, Any?>>() }
  }

  companion object {
    /** Default automatic-offline budget. */
    const val CACHE_BYTES = 1024L * 1024 * 1024
    const val DEFAULT_UA = "Mozilla/5.0 (Linux; Android 14; Chromecast) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  }
}
