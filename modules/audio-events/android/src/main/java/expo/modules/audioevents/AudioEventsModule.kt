package expo.modules.audioevents

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reports what changes playback from outside the app, matching the iOS module: remote commands (notification, lock screen,
 * headset and Bluetooth buttons) and audio interruptions (calls, other apps taking audio focus). nitro-player's Media3 player owns
 * focus and the media session; the patched player (patches/react-native-nitro-player) broadcasts these to this package
 * (`com.margelo.nitro.nitroplayer.EVENT`, never exported), and this module forwards them to JS.
 */
class AudioEventsModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("AudioEvents")
    Events("onRemoteCommand", "onInterruption")

    /** Idempotent. */
    Function("start") { attach() }

    OnDestroy { detach() }
  }

  private fun attach() {
    if (receiver != null) return
    val ctx: Context = appContext.reactContext ?: return
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.getStringExtra("type")) {
          "remote" -> sendEvent("onRemoteCommand", mapOf("command" to (intent.getStringExtra("value") ?: "toggle")))
          "interruption" -> sendEvent("onInterruption", mapOf("phase" to (intent.getStringExtra("value") ?: "began")))
        }
      }
    }
    val filter = IntentFilter("com.margelo.nitro.nitroplayer.EVENT")
    if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
    else ctx.registerReceiver(r, filter)
    receiver = r
  }

  private fun detach() {
    val r = receiver ?: return
    receiver = null
    try {
      appContext.reactContext?.unregisterReceiver(r)
    } catch (_: Exception) {}
  }
}
