package expo.modules.tvkeys

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Forwards TV remote keys (media keys always; D-pad left/right when JS asks) from the Activity to JS. */
class TvKeysModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TvKeys")
    Events("onKey", "onNavKey")

    OnCreate {
      TvKeys.sink = { key, repeat -> sendEvent("onKey", mapOf("key" to key, "repeat" to repeat)) }
      TvKeys.navSink = { key -> sendEvent("onNavKey", mapOf("key" to key)) }
    }
    OnDestroy {
      TvKeys.sink = null
      TvKeys.navSink = null
    }

    Function("setCaptured") { keys: List<String> -> TvKeys.captured = keys.toSet() }
  }
}
