package expo.modules.streamproxy

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.util.Log

/** MediaCodecList probe: for avc1 / vp9 / av01 the tallest 16:9 frame (30 fps) a decoder handles, preferring hardware. */
object DecoderCaps {
  private val MIMES = mapOf("avc1" to MediaFormat.MIMETYPE_VIDEO_AVC, "vp9" to MediaFormat.MIMETYPE_VIDEO_VP9, "av01" to "video/av01")
  private val HEIGHTS = listOf(2160, 1440, 1080, 720, 480, 360)

  fun read(): Map<String, Any> {
    val out = HashMap<String, Any>()
    val infos = MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.filter { !it.isEncoder }
    for ((family, mime) in MIMES) {
      var best: Pair<Int, Boolean>? = null
      for (info in infos) {
        if (info.supportedTypes.none { it.equals(mime, true) }) continue
        val hw = if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated && !info.isSoftwareOnly else !info.name.startsWith("OMX.google") && !info.name.startsWith("c2.android")
        val caps = try { info.getCapabilitiesForType(mime).videoCapabilities } catch (_: Exception) { null } ?: continue
        val h = HEIGHTS.firstOrNull { caps.isSizeSupported(it * 16 / 9, it) && caps.areSizeAndRateSupported(it * 16 / 9, it, 30.0) } ?: continue
        val cur = best
        if (cur == null || (hw && !cur.second) || (hw == cur.second && h > cur.first)) best = Pair(h, hw)
      }
      best?.let { out[family] = mapOf("maxHeight" to it.first, "hw" to it.second) }
    }
    Log.i(ProxyServer.TAG, "decoder caps: $out")
    return out
  }
}
