package expo.modules.sangeetremote

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

private const val TAG = "SangeetRemote"

/**
 * Phone side of the remote on Android: finds Sangeet TVs (`_sangeet._tcp`, registered by [RemoteHub]) with NSD and opens
 * the newline-framed TCP connection to one. Same events and ids contract as the iOS module: onService {key, name, tvId, found},
 * onOpen / onData / onClose {conn, ...}. Connection ids start with "k" so they never clash with the TV-side ones.
 */
class RemoteClient(ctx: Context, private val emit: (String, Map<String, Any?>) -> Unit) {
  private val nsd = ctx.applicationContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
  private var discovery: NsdManager.DiscoveryListener? = null
  private val found = ConcurrentHashMap<String, Pair<String, Int>>()
  private val conns = ConcurrentHashMap<String, Socket>()
  private val seq = AtomicInteger()
  // NsdManager (before API 34) resolves one service at a time.
  private val resolving = Semaphore(1)

  fun startBrowse() {
    stopBrowse()
    val mgr = nsd ?: return
    val l = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) {}
      override fun onDiscoveryStopped(type: String) {}
      override fun onStartDiscoveryFailed(type: String, code: Int) { Log.w(TAG, "discovery failed $code") }
      override fun onStopDiscoveryFailed(type: String, code: Int) {}
      override fun onServiceFound(info: NsdServiceInfo) { resolve(info) }
      override fun onServiceLost(info: NsdServiceInfo) {
        found.remove(info.serviceName)
        emit("onService", mapOf("key" to info.serviceName, "name" to info.serviceName, "tvId" to info.serviceName, "found" to false))
      }
    }
    try {
      mgr.discoverServices("_sangeet._tcp.", NsdManager.PROTOCOL_DNS_SD, l)
      discovery = l
    } catch (e: Exception) { Log.w(TAG, "discover failed: ${e.message}") }
  }

  fun stopBrowse() {
    val l = discovery ?: return
    discovery = null
    try { nsd?.stopServiceDiscovery(l) } catch (_: Exception) {}
    found.clear()
  }

  @Suppress("DEPRECATION")
  private fun resolve(info: NsdServiceInfo) {
    val mgr = nsd ?: return
    thread(isDaemon = true, name = "sangeet-nsd-resolve") {
      try {
        if (!resolving.tryAcquire(10, TimeUnit.SECONDS)) return@thread
      } catch (_: InterruptedException) { return@thread }
      try {
        mgr.resolveService(info, object : NsdManager.ResolveListener {
          override fun onResolveFailed(i: NsdServiceInfo, code: Int) { resolving.release() }
          override fun onServiceResolved(i: NsdServiceInfo) {
            resolving.release()
            val host = i.host?.hostAddress ?: return
            found[i.serviceName] = Pair(host, i.port)
            fun txt(k: String) = i.attributes[k]?.toString(Charsets.UTF_8)
            emit("onService", mapOf("key" to i.serviceName, "name" to (txt("name") ?: i.serviceName), "tvId" to (txt("id") ?: i.serviceName), "found" to true))
          }
        })
      } catch (_: Exception) { resolving.release() }
    }
  }

  /** target: "host:port" or "svc:<key of a discovered TV>". Returns the connection id at once; events follow. */
  fun connect(target: String): String {
    val id = "k${seq.incrementAndGet()}"
    thread(isDaemon = true, name = "sangeet-remote-$id") {
      var error: String? = null
      val sock = Socket()
      try {
        val addr = if (target.startsWith("svc:")) {
          val hp = found[target.removePrefix("svc:")] ?: throw IllegalStateException("TV not found")
          InetSocketAddress(hp.first, hp.second)
        } else {
          val i = target.lastIndexOf(':')
          if (i <= 0) throw IllegalArgumentException("Bad address")
          InetSocketAddress(target.substring(0, i), target.substring(i + 1).toInt())
        }
        sock.tcpNoDelay = true
        sock.connect(addr, 6000)
        conns[id] = sock
        emit("onOpen", mapOf("conn" to id))
        val r = sock.getInputStream().bufferedReader(Charsets.UTF_8)
        while (true) {
          val line = r.readLine() ?: break
          if (line.length > 4_000_000) break
          emit("onData", mapOf("conn" to id, "data" to line + "\n"))
        }
      } catch (e: Exception) {
        error = e.message ?: "Connection failed"
      }
      conns.remove(id)
      try { sock.close() } catch (_: Exception) {}
      emit("onClose", if (error != null) mapOf("conn" to id, "error" to error) else mapOf("conn" to id))
    }
    return id
  }

  fun owns(id: String) = id.startsWith("k")

  fun send(id: String, data: String) {
    val s = conns[id] ?: return
    thread(isDaemon = true) {
      try { synchronized(s) { s.getOutputStream().apply { write(data.toByteArray(Charsets.UTF_8)); flush() } } } catch (_: Exception) { close(id) }
    }
  }

  fun close(id: String) {
    val s = conns.remove(id) ?: return
    try { s.close() } catch (_: Exception) {}
  }
}
