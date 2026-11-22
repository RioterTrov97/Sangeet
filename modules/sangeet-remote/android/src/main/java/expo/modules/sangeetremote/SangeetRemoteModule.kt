package expo.modules.sangeetremote

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.SecureRandom

/**
 * TV side of the Sangeet remote. The listener and mDNS advertisement live in [RemoteHub] (kept alive by
 * [RemoteService]); this module only attaches the JS app to it. The protocol itself lives in JS (src/remote).
 */
class SangeetRemoteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SangeetRemote")
    Events("onAccept", "onData", "onClose")

    OnDestroy { RemoteHub.detach() }

    /** Attaches the app to the hub (starting it and the service if needed). Returns the bound port. */
    Function("startServer") { _: Int, name: String, tvId: String ->
      val ctx = appContext.reactContext?.applicationContext ?: throw IllegalStateException("no context")
      RemoteHub.ensureStarted(ctx, Pair(name, tvId))
      RemoteService.start(ctx)
      RemoteHub.attach { event, payload -> sendEvent(event, payload) }
      RemoteHub.PORT
    }
    Function("stopServer") { RemoteHub.detach() }
    Function("send") { id: String, data: String -> RemoteHub.send(id, data) }
    Function("close") { id: String -> RemoteHub.drop(id) }
    Function("randomHex") { bytes: Int ->
      val b = ByteArray(maxOf(1, bytes))
      SecureRandom().nextBytes(b)
      b.joinToString("") { "%02x".format(it) }
    }
  }
}
