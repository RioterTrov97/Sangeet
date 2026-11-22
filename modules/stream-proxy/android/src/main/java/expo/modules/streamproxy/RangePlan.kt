package expo.modules.streamproxy

/**
 * Pure decisions for upstream range requests (no state, no networking; the Swift twin is ios/RangePlan.swift and must behave
 * identically). Behaviour as in yt-dlp and NewPipe: googlevideo clients that answer a header `Range` for a later part of the file
 * with 403 are served by the `&range=a-b` query form instead, in bounded chunks.
 */
object RangePlan {
  /** Largest chunk for a stream that has shown the later-range 403. */
  const val FLAGGED_MAX_CHUNK = 1024L * 1024

  /** A later part (from > 0) of a stream that already 403'd on a header range goes straight to the query form. */
  fun useQueryForm(from: Long, flagged: Boolean): Boolean = flagged && from > 0

  fun chunkCap(flagged: Boolean, normal: Long): Long = if (flagged) minOf(normal, FLAGGED_MAX_CHUNK) else normal

  /** Never open-ended: `to` is clamped to the known content length. */
  fun boundedTo(from: Long, to: Long, length: Long): Long = maxOf(from, if (length > 0) minOf(to, length - 1) else to)

  private fun withParam(url: String, name: String, value: String): String {
    val q = url.indexOf('?')
    if (q < 0) return "$url?$name=$value"
    val base = url.substring(0, q)
    val kept = url.substring(q + 1).split('&').filter { it.isNotEmpty() && !it.startsWith("$name=") }
    return base + "?" + (kept + "$name=$value").joinToString("&")
  }

  /** `url` with `range=from-to` (an existing `range` is replaced). */
  fun withQueryRange(url: String, from: Long, to: Long): String = withParam(url, "range", "$from-$to")

  /** `url` with `rn=<n>` (the request counter NewPipe sends) for /videoplayback URLs only; others are returned unchanged. */
  fun withRn(url: String, n: Int): String = if (url.substringBefore('?').contains("videoplayback")) withParam(url, "rn", "$n") else url
}
