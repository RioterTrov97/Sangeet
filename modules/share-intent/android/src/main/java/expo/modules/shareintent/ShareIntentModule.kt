package expo.modules.shareintent

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Text shared to Sangeet from another app (ACTION_SEND, text/plain): a YouTube / YouTube Music / Spotify link. Links opened with
 * ACTION_VIEW arrive through expo-linking instead. A share is handed over once, so a recreated activity does not replay it.
 */
class ShareIntentModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareIntent")
    Events("onShare")

    /** The text that launched the app, or null. */
    Function("getInitial") { take(appContext.currentActivity?.intent) }

    OnNewIntent { intent ->
      take(intent)?.let { sendEvent("onShare", mapOf("text" to it)) }
    }
  }

  private fun take(intent: Intent?): String? {
    if (intent?.action != Intent.ACTION_SEND) return null
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
    intent.action = null
    return text?.takeIf { it.isNotBlank() }
  }
}
