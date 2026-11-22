package expo.modules.streamproxy

import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

data class ProxyStream(
  val url: String,
  val length: Long,
  val mime: String,
  val userAgent: String,
  val headers: Map<String, String> = emptyMap(),
  /** Epoch ms when the upstream URL expires (0 = unknown). */
  val expiresAt: Long = 0,
  /** DASH byte ranges (inclusive, -1 = unknown) and track details, for the local manifest. */
  val initStart: Long = -1,
  val initEnd: Long = -1,
  val indexStart: Long = -1,
  val indexEnd: Long = -1,
  val codecs: String = "",
  val width: Long = 0,
  val height: Long = 0,
  val bitrate: Long = 0,
  val durationMs: Long = 0,
)

/**
 * Minimal HTTP/1.1 server on 127.0.0.1 for ExoPlayer. `/v/<id>` audio, `/vx/<id>` muxed progressive (key `m:<id>`),
 * `/vv/<id>` video-only (key `v:<id>`), `/vd/<id>.mpd` a DASH manifest merging the video-only and audio streams
 * (ExoPlayer plays both through this proxy, so the range/throttling handling below applies to each). Fetches googlevideo in growing Range chunks (256 KB doubling to 8 MB, two in flight)
 * because single requests over ~10 MB get throttled. The URL is resolved lazily by JS (onResolveRequest -> fulfill/reject).
 */
class ProxyServer {
  var onResolveRequest: ((String, String, Boolean) -> Unit)? = null

  private val streams = ConcurrentHashMap<String, ProxyStream>()
  private val pending = ConcurrentHashMap<String, CompletableFuture<ProxyStream>>()
  private val inflight = HashMap<String, CompletableFuture<ProxyStream>>()
  /** Per stream: when the last 403-driven re-resolve happened and how many in a row (exponential backoff). */
  private val refreshes = ConcurrentHashMap<String, Pair<Long, Int>>()
  private val pool: ExecutorService = Executors.newCachedThreadPool()
  private var socket: ServerSocket? = null

  /** Whole-song disk cache (LRU, capped): see [SongCache]. Null until [initCache] ran (then nothing is cached). */
  @Volatile var cache: SongCache? = null
  private val fillPool: ExecutorService = Executors.newFixedThreadPool(3)
  /** Songs being downloaded in full right now (id -> bytes written so far, contiguous from byte 0). */
  private val filling = ConcurrentHashMap<String, Long>()
  /** Streams (by id) whose header-Range request for a later part 403'd: they use the `range=` query form and 1 MiB chunks from then on. */
  private val rangeQuery: MutableSet<String> = ConcurrentHashMap.newKeySet()
  /** Per-stream request counter sent as `rn` on /videoplayback requests. */
  private val rnCounters = ConcurrentHashMap<String, Int>()

  /** Called when a song finished downloading into the cache (JS then ranks and trims by value). */
  var onCached: ((String) -> Unit)? = null

  fun initCache(dir: File, capBytes: Long) {
    if (cache == null) cache = SongCache(dir, capBytes)
  }

  @Synchronized
  fun start(): Int {
    socket?.let { if (!it.isClosed) return it.localPort }
    val s = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    socket = s
    pool.execute {
      while (!s.isClosed) {
        try {
          val c = s.accept()
          pool.execute { handle(c) }
        } catch (_: IOException) {
        }
      }
    }
    Log.i(TAG, "listening on 127.0.0.1:${s.localPort}")
    return s.localPort
  }

  fun stop() {
    socket?.close()
  }

  fun prime(id: String, s: ProxyStream) {
    streams[id] = s
    startFill(id, s) // upcoming tracks are prefetched: download them completely in the background
  }

  fun unregister(id: String) {
    streams.remove(id)
  }

  fun fulfill(requestId: String, s: ProxyStream) {
    pending.remove(requestId)?.complete(s)
  }

  fun reject(requestId: String, reason: String) {
    pending.remove(requestId)?.completeExceptionally(IOException("resolve failed: $reason"))
  }

  /** A usable stream for [id]; asks JS when unknown/expired or when [stale] is the URL that just failed. */
  private fun resolve(id: String, stale: String? = null): ProxyStream {
    streams[id]?.let { if (it.url != stale && (it.expiresAt == 0L || it.expiresAt > System.currentTimeMillis() + 60_000)) return it }
    if (stale != null) {
      // A 403/410 on the cached URL. Re-resolving is only worth it when the URL changed or expired; otherwise back off
      // (15 s, 30 s, ... 5 min) so a stream that keeps answering 403 cannot hammer YouTube.
      val (last, n) = refreshes[id] ?: Pair(0L, 0)
      val wait = minOf(15_000L shl minOf(n, 5), 300_000L)
      val since = System.currentTimeMillis() - last
      if (since < wait) {
        Log.w(TAG, "refresh of $id suppressed (backoff ${wait / 1000}s, last ${since / 1000}s ago, #$n)")
        throw IOException("upstream keeps answering 403 for $id")
      }
      refreshes[id] = Pair(System.currentTimeMillis(), n + 1)
      Log.i(TAG, "refreshing $id after 403 (#${n + 1})")
    } else {
      refreshes.remove(id) // an ordinary (first / expired) resolve starts the backoff over
    }
    val fut: CompletableFuture<ProxyStream>
    val mine: Boolean
    synchronized(inflight) {
      val e = inflight[id]
      mine = e == null
      fut = e ?: CompletableFuture<ProxyStream>().also { inflight[id] = it }
    }
    if (mine) {
      val rid = UUID.randomUUID().toString()
      pending[rid] = CompletableFuture<ProxyStream>().also { p ->
        p.whenComplete { v, err ->
          synchronized(inflight) { inflight.remove(id) }
          if (err != null) fut.completeExceptionally(err) else fut.complete(v)
        }
      }
      Log.i(TAG, "resolve request $id ($rid)")
      onResolveRequest?.invoke(id, rid, stale != null)
      pool.execute {
        try {
          Thread.sleep(40_000)
        } catch (_: InterruptedException) {
        }
        reject(rid, "timeout")
      }
    }
    val s = try {
      fut.get(45, TimeUnit.SECONDS)
    } catch (e: Exception) {
      throw IOException("resolve failed: ${e.cause?.message ?: e.message}")
    }
    streams[id] = s
    return s
  }

  private fun routeKey(path: String): String? {
    var name = path.substringBefore('?')
    val prefix = when {
      name.startsWith("/vv/") -> "v:".also { name = name.removePrefix("/vv/") }
      name.startsWith("/vx/") -> "m:".also { name = name.removePrefix("/vx/") }
      name.startsWith("/v/") -> "".also { name = name.removePrefix("/v/") }
      else -> return null
    }
    if (name.endsWith(".m3u8")) return null
    name = name.substringBeforeLast('.', name)
    return prefix + name
  }

  private fun handle(c: Socket) {
    c.use {
      try {
        c.tcpNoDelay = true
        val input = BufferedInputStream(c.getInputStream())
        val out = c.getOutputStream()
        while (true) {
          val head = readHead(input) ?: return
          if (!respond(out, head)) return
        }
      } catch (_: IOException) {
        // client went away
      } catch (e: Exception) {
        Log.w(TAG, "connection failed: $e")
      }
    }
  }

  private fun readHead(input: BufferedInputStream): String? {
    val sb = StringBuilder()
    while (!sb.endsWith("\r\n\r\n")) {
      val b = input.read()
      if (b < 0) return null
      sb.append(b.toChar())
      if (sb.length > 64 * 1024) return null
    }
    return sb.toString()
  }

  private fun plain(out: OutputStream, status: String, extra: String = "", close: Boolean = true) {
    out.write("HTTP/1.1 $status\r\nContent-Length: 0\r\n$extra${if (close) "Connection: close\r\n" else ""}\r\n".toByteArray())
    out.flush()
  }

  /** Returns true to keep the connection alive. */
  private fun respond(out: OutputStream, head: String): Boolean {
    val lines = head.split("\r\n")
    val first = lines[0].split(" ")
    if (first.size < 2) return false
    val method = first[0]
    val path = first[1]
    var range: String? = null
    for (l in lines.drop(1)) {
      val i = l.indexOf(':')
      if (i > 0 && l.substring(0, i).trim().equals("range", true)) range = l.substring(i + 1).trim()
    }
    if (path.startsWith("/vd/") && path.substringBefore('?').endsWith(".mpd")) return manifest(out, method, path.substringBefore('?').removePrefix("/vd/").removeSuffix(".mpd"))
    val id = routeKey(path)
    if (id == null) {
      plain(out, "404 Not Found")
      return false
    }
    cache?.complete(id)?.let { f -> return serveFile(out, method, path, range, f) }
    val s = try {
      withLength(id, resolve(id))
    } catch (e: IOException) {
      Log.w(TAG, "resolve $id failed: ${e.message}")
      plain(out, "502 Bad Gateway")
      return false
    }
    startFill(id, s)
    val (start, end, partial) = parseRange(range, s.length)
    Log.i(TAG, "$method $path range=${range ?: "-"} -> $start-$end")
    if (start > end || start >= s.length) {
      plain(out, "416 Range Not Satisfiable", "Content-Range: bytes */${s.length}\r\n", close = false)
      return true
    }
    val h = StringBuilder(if (partial) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
    h.append("Content-Type: ${s.mime}\r\nAccept-Ranges: bytes\r\nContent-Length: ${end - start + 1}\r\n")
    if (partial) h.append("Content-Range: bytes $start-$end/${s.length}\r\n")
    h.append("Connection: keep-alive\r\n\r\n")
    out.write(h.toString().toByteArray())
    if (method == "HEAD") {
      out.flush()
      return true
    }
    // Two chunk fetches in flight so the next one is downloading while the current one is written.
    val queue = ArrayDeque<Future<ByteArray>>()
    var next = start
    var size = MIN_CHUNK
    try {
      fun fill() {
        while (queue.size < 2 && next <= end) {
          val from = next
          val to = minOf(from + size - 1, end)
          queue.addLast(pool.submit<ByteArray> { fromPartial(id, from, to) ?: fetchChunk(id, from, to) })
          next = to + 1
          size = minOf(size * 2, RangePlan.chunkCap(rangeQuery.contains(id), MAX_CHUNK))
        }
      }
      fill()
      while (queue.isNotEmpty()) {
        val data = try {
          queue.removeFirst().get()
        } catch (e: Exception) {
          throw IOException(e.cause?.message ?: e.message)
        }
        fill()
        out.write(data)
      }
      out.flush()
    } finally {
      queue.forEach { it.cancel(true) }
    }
    return true
  }

  /** Serves [f] (a fully cached song) for the request's Range without touching the network. */
  private fun serveFile(out: OutputStream, method: String, path: String, range: String?, f: File): Boolean {
    val len = f.length()
    val (start, end, partial) = parseRange(range, len)
    Log.i(TAG, "$method $path range=${range ?: "-"} -> $start-$end (cache)")
    if (start > end || start >= len) {
      plain(out, "416 Range Not Satisfiable", "Content-Range: bytes */$len\r\n", close = false)
      return true
    }
    val mime = if (f.name.endsWith(".webm")) "audio/webm" else "audio/mp4"
    val h = StringBuilder(if (partial) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
    h.append("Content-Type: $mime\r\nAccept-Ranges: bytes\r\nContent-Length: ${end - start + 1}\r\n")
    if (partial) h.append("Content-Range: bytes $start-$end/$len\r\n")
    h.append("Connection: keep-alive\r\n\r\n")
    out.write(h.toString().toByteArray())
    if (method == "HEAD") {
      out.flush()
      return true
    }
    f.setLastModified(System.currentTimeMillis())
    RandomAccessFile(f, "r").use { r ->
      r.seek(start)
      val buf = ByteArray(64 * 1024)
      var left = end - start + 1
      while (left > 0) {
        val n = r.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
        if (n < 0) throw IOException("cache file shorter than expected")
        out.write(buf, 0, n)
        left -= n
      }
    }
    out.flush()
    return true
  }

  /** Bytes already downloaded by the background filler, when the whole range is there. */
  private fun fromPartial(id: String, from: Long, to: Long): ByteArray? {
    val have = filling[id] ?: return null
    if (to >= have) return null
    val f = cache?.part(id, streams[id]?.mime ?: "") ?: return null
    return try {
      RandomAccessFile(f, "r").use { r ->
        val b = ByteArray((to - from + 1).toInt())
        r.seek(from)
        r.readFully(b)
        b
      }
    } catch (_: IOException) {
      null
    }
  }

  /**
   * Downloads the whole of [id] in 1-2 MB chunks into the cache (one background download per song, at most three at a
   * time). Every chunk goes through [fetchChunk], so a 403/expired URL is re-resolved and the download carries on from the
   * same byte. The file only becomes visible to [SongCache.complete] when every byte is there.
   */
  private fun startFill(id: String, s: ProxyStream) {
    val c = cache ?: return
    if (c.capBytes <= 0 || id.contains(':') || s.length <= 0 || c.complete(id) != null) return
    if (filling.putIfAbsent(id, 0L) != null) return
    fillPool.execute {
      var ok = false
      try {
        val part = c.part(id, s.mime)
        part.delete()
        RandomAccessFile(part, "rw").use { f ->
          var pos = 0L
          var size = FILL_CHUNK_MIN
          while (pos < s.length) {
            val to = minOf(pos + size - 1, s.length - 1)
            val data = fetchChunk(id, pos, to)
            f.seek(pos)
            f.write(data)
            pos = to + 1
            filling[id] = pos
            size = RangePlan.chunkCap(rangeQuery.contains(id), FILL_CHUNK_MAX)
          }
        }
        if (part.length() != s.length) throw IOException("size mismatch ${part.length()} != ${s.length}")
        ok = c.finish(id, s.mime)
        Log.i(TAG, "cached $id (${s.length} bytes)")
      } catch (e: Exception) {
        Log.w(TAG, "background download of $id stopped: ${e.message}")
        c.part(id, s.mime).delete()
      } finally {
        filling.remove(id)
        if (ok) {
          c.trim(setOf(id) + filling.keys)
          onCached?.invoke(id)
        }
      }
    }
  }

  private fun esc(v: String) = v.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;")

  private fun representation(id: String, route: String, s: ProxyStream, video: Boolean): String {
    val bw = if (s.bitrate > 0) s.bitrate else if (video) 2_000_000 else 128_000
    val size = if (video && s.width > 0) " width=\"${s.width}\" height=\"${s.height}\"" else ""
    return "<Representation id=\"$id\" codecs=\"${esc(s.codecs)}\" bandwidth=\"$bw\"$size><BaseURL>$route</BaseURL>" +
      "<SegmentBase indexRange=\"${s.indexStart}-${s.indexEnd}\"><Initialization range=\"${s.initStart}-${s.initEnd}\"/></SegmentBase></Representation>"
  }

  /** Static on-demand DASH manifest for [id]: video-only `v:<id>` + audio `<id>` as separate adaptation sets (merged by ExoPlayer). */
  private fun manifest(out: OutputStream, method: String, id: String): Boolean {
    try {
      val v = resolve("v:$id")
      val a = resolve(id)
      if (v.initStart < 0 || v.indexStart < 0 || a.initStart < 0 || a.indexStart < 0) throw IOException("missing DASH ranges")
      val dur = (if (v.durationMs > 0) v.durationMs else a.durationMs) / 1000.0
      val aMime = a.mime.ifEmpty { "audio/mp4" }
      val vMime = v.mime.ifEmpty { "video/mp4" }
      val xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" type=\"static\" profiles=\"urn:mpeg:dash:profile:isoff-on-demand:2011\" minBufferTime=\"PT2S\" mediaPresentationDuration=\"PT${"%.3f".format(java.util.Locale.US, dur)}S\">" +
        "<Period>" +
        "<AdaptationSet id=\"0\" contentType=\"video\" mimeType=\"$vMime\" subsegmentAlignment=\"true\">${representation("v", "/vv/$id.${if (vMime.contains("webm")) "webm" else "mp4"}", v, true)}</AdaptationSet>" +
        "<AdaptationSet id=\"1\" contentType=\"audio\" mimeType=\"$aMime\" lang=\"und\" subsegmentAlignment=\"true\">${representation("a", "/v/$id.${if (aMime.contains("webm")) "webm" else "m4a"}", a, false)}</AdaptationSet>" +
        "</Period></MPD>"
      Log.i(TAG, "manifest $id video itag-mime=$vMime ${v.codecs} ${v.width}x${v.height} audio=$aMime ${a.codecs} dur=$dur")
      val body = xml.toByteArray()
      out.write("HTTP/1.1 200 OK\r\nContent-Type: application/dash+xml\r\nContent-Length: ${body.size}\r\nConnection: keep-alive\r\n\r\n".toByteArray())
      if (method != "HEAD") out.write(body)
      out.flush()
      return true
    } catch (e: IOException) {
      Log.w(TAG, "manifest $id failed: ${e.message}")
      plain(out, "502 Bad Gateway")
      return false
    }
  }

  /** Muxed video streams come without a content length: learn it from `Content-Range: bytes 0-1/<total>` of a 2-byte probe. */
  private fun withLength(id: String, s: ProxyStream): ProxyStream {
    if (s.length > 0) return s
    val conn = URL(s.url).openConnection() as HttpURLConnection
    conn.connectTimeout = 15_000
    conn.readTimeout = 15_000
    conn.setRequestProperty("Range", "bytes=0-1")
    conn.setRequestProperty("User-Agent", s.userAgent)
    conn.setRequestProperty("Origin", "https://www.youtube.com")
    conn.setRequestProperty("Referer", "https://www.youtube.com/")
    s.headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
    try {
      val total = conn.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
        ?: throw IOException("unknown stream length (HTTP ${conn.responseCode})")
      val withLen = s.copy(length = total)
      streams[id] = withLen
      Log.i(TAG, "learned length of $id: $total")
      return withLen
    } finally {
      conn.disconnect()
    }
  }

  private fun parseRange(header: String?, length: Long): Triple<Long, Long, Boolean> {
    if (header == null || !header.lowercase().startsWith("bytes=")) return Triple(0L, length - 1, false)
    val spec = header.substring(6).split(",")[0]
    val p = spec.split("-", limit = 2)
    if (p.size != 2) return Triple(0L, length - 1, false)
    if (p[0].isEmpty()) {
      val n = p[1].toLongOrNull() ?: return Triple(0L, length - 1, false)
      return Triple(maxOf(0L, length - n), length - 1, true)
    }
    val a = p[0].toLongOrNull() ?: return Triple(0L, length - 1, false)
    val b = p[1].toLongOrNull()?.let { minOf(it, length - 1) } ?: (length - 1)
    return Triple(a, b, true)
  }

  /** True when `bytes=0-1` on this URL answers 206/200: the URL itself is valid. */
  private fun probeStart(s: ProxyStream): Boolean {
    val conn = URL(s.url).openConnection() as HttpURLConnection
    return try {
      conn.connectTimeout = 15_000
      conn.readTimeout = 15_000
      conn.setRequestProperty("Range", "bytes=0-1")
      conn.setRequestProperty("User-Agent", s.userAgent)
      conn.setRequestProperty("Origin", "https://www.youtube.com")
      conn.setRequestProperty("Referer", "https://www.youtube.com/")
      s.headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
      conn.responseCode.let { it == 206 || it == 200 }
    } catch (e: IOException) {
      false
    } finally {
      conn.disconnect()
    }
  }

  private fun nextRn(key: String): Int = rnCounters.compute(key) { _, v -> (v ?: 0) + 1 }!!

  private fun fetchChunk(id: String, from: Long, wanted: Long): ByteArray {
    var s = resolve(id)
    val to = RangePlan.boundedTo(from, wanted, s.length)
    var refreshed = false
    var flipped = false
    var last: Exception = IOException("upstream failed")
    var tries = 0
    while (tries < 3) {
      tries++
      try {
        // Header Range, unless this stream already 403'd on one for a later part: then the `range=` query form (bounded, never open-ended).
        val query = RangePlan.useQueryForm(from, rangeQuery.contains(id))
        val base = if (query) RangePlan.withQueryRange(s.url, from, to) else s.url
        val conn = URL(RangePlan.withRn(base, nextRn(id))).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        if (!query) conn.setRequestProperty("Range", "bytes=$from-$to")
        conn.setRequestProperty("User-Agent", s.userAgent)
        conn.setRequestProperty("Origin", "https://www.youtube.com")
        conn.setRequestProperty("Referer", "https://www.youtube.com/")
        s.headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        val code = conn.responseCode
        if (code == 206 || (code == 200 && from == 0L)) {
          val data = conn.inputStream.use { it.readBytes() }
          val want = (to - from + 1).toInt()
          if (code == 206 || data.size == want) return data
          if (data.size > want) return data.copyOf(want)
        }
        Log.w(TAG, "upstream $id $from-$to try=$tries form=${if (query) "query" else "header"} status=$code")
        conn.disconnect()
        // A header Range for a later part refused with 403 while a fresh 0-1 probe on the same URL is served: remember it for this
        // stream (query form and 1 MiB chunks from now on) and retry that way. No re-resolve for it (no resolve loops).
        if (code == 403 && from > 0 && !query && !flipped && probeStart(s)) {
          flipped = true
          rangeQuery.add(id)
          Log.i(TAG, "range-403 $id $from-$to: probe 0-1 is served, using the range= query form for this stream")
          continue
        }
        if ((code == 403 || code == 410) && !refreshed && !flipped) {
          refreshed = true
          s = resolve(id, s.url)
          tries = 0
          continue
        }
        last = IOException("upstream HTTP $code")
      } catch (e: IOException) {
        last = e
      }
    }
    throw last
  }

  companion object {
    const val TAG = "StreamProxy"
    const val MIN_CHUNK = 256L * 1024
    const val MAX_CHUNK = 8L * 1024 * 1024
    const val FILL_CHUNK_MIN = 1L * 1024 * 1024
    const val FILL_CHUNK_MAX = 2L * 1024 * 1024
  }
}
