package expo.modules.appupdater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import expo.modules.kotlin.Promise
import java.util.concurrent.ConcurrentHashMap

/** Receives PackageInstaller session results: starts the confirmation screen when needed, resolves the JS promise otherwise. */
class UpdateStatusReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    val id = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      @Suppress("DEPRECATION")
      val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
      confirm?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
      return
    }
    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
    pending.remove(id)?.resolve(mapOf("status" to status, "message" to message))
  }

  companion object {
    const val ACTION = "expo.modules.appupdater.INSTALL_RESULT"
    val pending = ConcurrentHashMap<Int, Promise>()
  }
}
