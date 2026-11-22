package expo.modules.sangeetremote

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.SecureRandom

/**
 * Sangeet remote on Android. TV side: The listener and mDNS advertisement live in [RemoteHub] (kept alive by
 * [RemoteService]); this module only attaches the JS app to it. Phone side: [RemoteClient] (NSD discovery and the outgoing connection). The protocol itself lives in JS (src/remote).
 */
class SangeetRemoteModule : Module() {
  /** Phone side (discovery and outgoing connections); created on first use. */
  private val client: RemoteClient by lazy {
    RemoteClient(appContext.reactContext ?: throw IllegalStateException("no context")) { event, payload -> sendEvent(event, payload) }
  }

  override fun definition() = ModuleDefinition {
    Name("SangeetRemote")
    Events("onAccept", "onData", "onClose", "onOpen", "onService")

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
    Function("send") { id: String, data: String -> if (client.owns(id)) client.send(id, data) else RemoteHub.send(id, data) }
    Function("close") { id: String -> if (client.owns(id)) client.close(id) else RemoteHub.drop(id) }
    Function("startBrowse") { client.startBrowse() }
    Function("stopBrowse") { client.stopBrowse() }
    Function("connect") { target: String -> client.connect(target) }
    Function("randomHex") { bytes: Int ->
      val b = ByteArray(maxOf(1, bytes))
      SecureRandom().nextBytes(b)
      b.joinToString("") { "%02x".format(it) }
    }
  }
}
