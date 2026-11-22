package expo.modules.sangeetremote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Keeps the remote listener + mDNS advertisement alive with the UI closed. connectedDevice (not mediaPlayback)
 * because Android 14 does not allow starting a mediaPlayback foreground service from BOOT_COMPLETED.
 */
class RemoteService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("sangeet_remote", "Phone remote", NotificationManager.IMPORTANCE_MIN))
      val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "sangeet_remote") else Notification.Builder(this))
        .setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Sangeet is ready for your phone").setOngoing(true).build()
      if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) else startForeground(1, n)
    } catch (e: Exception) {
      Log.w("SangeetRemote", "foreground start refused: ${e.message}") // keep running as a plain service
    }
    RemoteHub.ensureStarted(this)
    return START_STICKY
  }

  companion object {
    fun start(ctx: Context) {
      if (!isTv(ctx)) return
      try {
        val i = Intent(ctx, RemoteService::class.java)
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
      } catch (e: Exception) { Log.w("SangeetRemote", "service start failed: ${e.message}") }
    }
  }
}
