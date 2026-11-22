package expo.modules.sangeetremote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Starts the remote service after boot and after the app is updated. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) = RemoteService.start(context)
}
