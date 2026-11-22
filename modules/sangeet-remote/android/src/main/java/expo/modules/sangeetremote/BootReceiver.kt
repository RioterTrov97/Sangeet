package expo.modules.sangeetremote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Starts the remote service after boot and after the app is updated. TV only: a phone is the remote, never the host. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (isTv(context)) RemoteService.start(context)
  }
}
