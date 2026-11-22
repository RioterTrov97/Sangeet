package expo.modules.sangeetremote

import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

private const val TAG = "SangeetRemote"

/**
 * Owns the TCP listener and the mDNS advertisement for the whole process. It is started by [RemoteService] (boot / app
 * start) so the TV is discoverable with the UI closed. While the React app runs it attaches a [sink] and gets the raw
 * newline-framed messages (the protocol lives in JS). While it does not, the hub answers `hello` itself, buffers play
 * commands, wakes the screen and launches the app; when JS attaches, buffered messages are replayed.
 * No polling: every thread blocks on a socket.
 */
object RemoteHub {
  const val PORT = 8765
  private const val PREFS = "sangeet_remote"

  private class Conn(val sock: Socket) {
    var hello: String? = null
    val cmds = ArrayList<String>()
    var announced = false
    var launched = false
  }

  @Volatile private var sink: ((String, Map<String, Any?>) -> Unit)? = null
  private var server: ServerSocket? = null
  private var nsd: NsdManager? = null
  private var reg: NsdManager.RegistrationListener? = null
  private val conns = ConcurrentHashMap<String, Conn>()
  private val seq = AtomicInteger()
  private lateinit var app: Context
  @Volatile var name = Build.MODEL ?: "Google TV"
  @Volatile var tvId = ""

  private val WAKE_TYPES = setOf("playQueue", "addToQueue", "playNext", "playIndex", "play", "next", "prev", "setMode", "setLayout")
  private val TYPE = Regex("\"t\"\\s*:\\s*\"(\\w+)\"")

  @Synchronized
  fun ensureStarted(ctx: Context, identity: Pair<String, String>? = null) {
    app = ctx.applicationContext
    val prefs = try { app.getSharedPreferences(PREFS, Context.MODE_PRIVATE) } catch (_: Exception) { null }
    if (identity != null) {
      name = identity.first; tvId = identity.second
      prefs?.edit()?.putString("name", name)?.putString("id", tvId)?.apply()
    } else if (tvId.isEmpty()) {
      prefs?.getString("name", null)?.let { name = it }
      tvId = prefs?.getString("id", null) ?: ByteArray(8).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
      prefs?.edit()?.putString("id", tvId)?.apply()
    }
    if (server != null) return
    val s = try { ServerSocket(PORT) } catch (e: Exception) { Log.w(TAG, "listen failed: ${e.message}"); return }
    server = s
    thread(name = "sangeet-remote-accept", isDaemon = true) {
      while (!s.isClosed) {
        val sock = try { s.accept() } catch (_: Exception) { break }
        // Home-LAN only: loopback (adb forward), link-local or private addresses.
        val peer = sock.inetAddress
        if (peer == null || !(peer.isLoopbackAddress || peer.isSiteLocalAddress || peer.isLinkLocalAddress)) {
          try { sock.close() } catch (_: Exception) {}
          continue
        }
        sock.tcpNoDelay = true
        val id = "c${seq.incrementAndGet()}"
        val c = Conn(sock)
        conns[id] = c
        sink?.let { it("onAccept", mapOf("conn" to id, "remote" to (peer.hostAddress ?: ""))); c.announced = true }
        thread(name = "sangeet-remote-$id", isDaemon = true) { read(id, c) }
      }
    }
    register(s.localPort)
    Log.i(TAG, "listening on ${s.localPort}")
  }

  @Synchronized
  fun attach(f: (String, Map<String, Any?>) -> Unit) {
    sink = f
    for ((id, c) in conns) {
      f("onAccept", mapOf("conn" to id, "remote" to ""))
      c.announced = true
      c.hello?.let { f("onData", mapOf("conn" to id, "data" to it + "\n")) }
      synchronized(c.cmds) { c.cmds.forEach { l -> f("onData", mapOf("conn" to id, "data" to l + "\n")) }; c.cmds.clear() }
    }
  }

  @Synchronized
  fun detach() {
    sink = null
    conns.values.forEach { it.announced = false }
  }

  fun send(id: String, data: String) {
    val c = conns[id] ?: return
    thread(isDaemon = true) { write(id, c, data) }
  }

  private fun write(id: String, c: Conn, data: String) {
    try {
      synchronized(c.sock) { c.sock.getOutputStream().apply { write(data.toByteArray(Charsets.UTF_8)); flush() } }
    } catch (_: Exception) { drop(id) }
  }

  fun drop(id: String) {
    val c = conns.remove(id) ?: return
    try { c.sock.close() } catch (_: Exception) {}
    if (c.announced) sink?.invoke("onClose", mapOf("conn" to id))
  }

  private fun read(id: String, c: Conn) {
    try {
      val r = c.sock.getInputStream().bufferedReader(Charsets.UTF_8)
      while (true) {
        val line = r.readLine() ?: break
        if (line.length > 4_000_000) break
        val type = TYPE.find(line)?.groupValues?.get(1)
        val play = type != null && type in WAKE_TYPES
        if (play) wake()
        val fg = foreground()
        if (type != null && type != "hello") Log.i(TAG, "cmd=$type fg=$fg interactive=${interactive()} jsAttached=${sink != null}")
        // App process is up but not the visible app (screen off, user went Home, another app): bring it to the front first.
        if (play && sink != null && (!interactive() || !fg)) launchUi()
        val s = sink
        if (s != null && c.announced) s("onData", mapOf("conn" to id, "data" to line + "\n"))
        else offline(id, c, type, line)
      }
    } catch (_: Exception) {}
    drop(id)
  }

  /** JS is not attached: answer hello, buffer commands, launch the UI on the first play-type command. */
  private fun offline(id: String, c: Conn, type: String?, line: String) {
    when (type) {
      "hello" -> {
        val v = try { JSONObject(line).optInt("v", -1) } catch (_: Exception) { -1 }
        if (v != 1) { write(id, c, "{\"t\":\"error\",\"code\":\"bad_version\"}\n"); drop(id); return }
        c.hello = line
        write(id, c, "{\"t\":\"welcome\",\"v\":1,\"tvId\":\"$tvId\",\"name\":${JSONObject.quote(name)}}\n")
        write(id, c, "{\"t\":\"state\",\"track\":null,\"position\":0,\"duration\":0,\"status\":\"idle\",\"queue\":[],\"index\":0,\"mode\":\"audio\",\"shuffle\":false,\"repeat\":\"off\"}\n")
      }
      "bye" -> drop(id)
      null -> {}
      else -> {
        if (c.hello == null || type !in WAKE_TYPES) return
        synchronized(c.cmds) { if (c.cmds.size < 20) c.cmds.add(line) }
        if (!c.launched) {
          c.launched = true
          write(id, c, "{\"t\":\"launching\"}\n")
        }
        launchUi()
      }
    }
  }

  /** True while one of our activities is the visible app (process importance FOREGROUND; a foreground service alone is lower). */
  private fun foreground(): Boolean {
    val info = android.app.ActivityManager.RunningAppProcessInfo()
    android.app.ActivityManager.getMyMemoryState(info)
    return info.importance <= android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private fun interactive(): Boolean = (app.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive

  @Suppress("DEPRECATION")
  private fun wake() {
    try {
      val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
      val lock = pm.newWakeLock(PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "sangeet:wake")
      lock.acquire(10_000)
    } catch (e: Exception) { Log.w(TAG, "wake failed: ${e.message}") }
  }

  private fun launchUi() {
    try {
      if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(app)) Log.w(TAG, "'Display over other apps' not granted: the UI may not start from the background (see INSTALL-TV.md)")
      val i = app.packageManager.getLaunchIntentForPackage(app.packageName) ?: return
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      app.startActivity(i)
    } catch (e: Exception) { Log.w(TAG, "launch failed: ${e.message}") }
  }

  private fun register(port: Int) {
    val mgr = app.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
    val info = NsdServiceInfo().apply {
      serviceName = "Sangeet-" + tvId.take(8)
      serviceType = "_sangeet._tcp."
      setPort(port)
      setAttribute("name", name)
      setAttribute("id", tvId)
      setAttribute("v", "1")
    }
    val l = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(i: NsdServiceInfo) {}
      override fun onRegistrationFailed(i: NsdServiceInfo, code: Int) { Log.w(TAG, "nsd registration failed $code") }
      override fun onServiceUnregistered(i: NsdServiceInfo) {}
      override fun onUnregistrationFailed(i: NsdServiceInfo, code: Int) {}
    }
    try { mgr.registerService(info, NsdManager.PROTOCOL_DNS_SD, l) } catch (_: Exception) { return }
    nsd = mgr; reg = l
  }
}
