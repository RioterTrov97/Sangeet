package expo.modules.appupdater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Downloads a release APK into cacheDir/updates and installs it through PackageInstaller (no server involved). */
class AppUpdaterModule : Module() {
  private val ctx: Context get() = appContext.reactContext ?: throw IllegalStateException("No context")
  private val dir: File get() = File(ctx.cacheDir, "updates").apply { mkdirs() }

  override fun definition() = ModuleDefinition {
    Name("AppUpdater")
    Events("onProgress")

    // Files downloaded before the installed build was installed are obsolete.
    OnCreate {
      try {
        val installed = ctx.packageManager.getPackageInfo(ctx.packageName, 0).lastUpdateTime
        dir.listFiles()?.filter { it.lastModified() < installed }?.forEach { it.delete() }
      } catch (_: Exception) {}
    }

    Function("canInstall") { ctx.packageManager.canRequestPackageInstalls() }

    Function("openInstallSettings") {
      val tries = listOf(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")),
        Intent(Settings.ACTION_SECURITY_SETTINGS),
        Intent(Settings.ACTION_SETTINGS),
      )
      for (i in tries) {
        try {
          ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          break
        } catch (_: Exception) {}
      }
    }

    AsyncFunction("download") { url: String, sha256: String?, fileName: String, promise: Promise ->
      Thread { download(url, sha256, fileName, promise) }.start()
    }

    AsyncFunction("install") { path: String, promise: Promise ->
      Thread { install(path, promise) }.start()
    }
  }

  private fun sha256Of(f: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    f.inputStream().use { i ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = i.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  private fun download(url: String, sha256: String?, fileName: String, promise: Promise) {
    try {
      val safe = File(fileName).name
      val target = File(dir, safe)
      dir.listFiles()?.filter { it.name != safe }?.forEach { it.delete() }
      // Already downloaded and verified (a previous launch): reuse it.
      if (target.exists() && sha256 != null && sha256Of(target).equals(sha256, ignoreCase = true)) {
        sendEvent("onProgress", mapOf("progress" to 1.0))
        promise.resolve(target.absolutePath)
        return
      }
      target.delete()
      val part = File(dir, "$safe.part")
      val conn = URL(url).openConnection() as HttpURLConnection
      conn.connectTimeout = 15_000
      conn.readTimeout = 30_000
      conn.instanceFollowRedirects = true
      try {
        if (conn.responseCode !in 200..299) throw java.io.IOException("HTTP ${conn.responseCode}")
        val total = conn.contentLengthLong
        val md = MessageDigest.getInstance("SHA-256")
        var done = 0L
        var lastPct = -1
        conn.inputStream.use { input ->
          part.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) {
              val n = input.read(buf)
              if (n < 0) break
              out.write(buf, 0, n)
              md.update(buf, 0, n)
              done += n
              if (total > 0) {
                val pct = (done * 100 / total).toInt()
                if (pct != lastPct) {
                  lastPct = pct
                  sendEvent("onProgress", mapOf("progress" to done.toDouble() / total))
                }
              }
            }
          }
        }
        val got = md.digest().joinToString("") { "%02x".format(it) }
        if (sha256 != null && !got.equals(sha256, ignoreCase = true)) {
          part.delete()
          throw java.io.IOException("Checksum mismatch")
        }
        if (!part.renameTo(target)) throw java.io.IOException("Could not save the update")
        sendEvent("onProgress", mapOf("progress" to 1.0))
        promise.resolve(target.absolutePath)
      } finally {
        conn.disconnect()
      }
    } catch (e: Exception) {
      File(dir, File(fileName).name + ".part").delete()
      promise.reject("ERR_DOWNLOAD", e.message ?: "Download failed", e)
    }
  }

  private fun install(path: String, promise: Promise) {
    try {
      val file = File(path)
      if (file.parentFile?.canonicalPath != dir.canonicalPath || !file.exists()) throw IllegalArgumentException("Not a downloaded update")
      dir.listFiles()?.filter { it.name != file.name }?.forEach { it.delete() }
      val installer = ctx.packageManager.packageInstaller
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
      params.setAppPackageName(ctx.packageName)
      if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
      val id = installer.createSession(params)
      UpdateStatusReceiver.pending[id] = promise
      try {
        installer.openSession(id).use { session ->
          file.inputStream().use { input ->
            session.openWrite("sangeet.apk", 0, file.length()).use { out ->
              input.copyTo(out)
              session.fsync(out)
            }
          }
          val intent = Intent(ctx, UpdateStatusReceiver::class.java).setAction(UpdateStatusReceiver.ACTION).setPackage(ctx.packageName)
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
          session.commit(PendingIntent.getBroadcast(ctx, id, intent, flags).intentSender)
        }
      } catch (e: Exception) {
        UpdateStatusReceiver.pending.remove(id)
        try { installer.abandonSession(id) } catch (_: Exception) {}
        throw e
      }
    } catch (e: Exception) {
      promise.reject("ERR_INSTALL", e.message ?: "Install failed", e)
    }
  }
}
