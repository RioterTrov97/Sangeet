import AVFoundation
import ExpoModulesCore
import MediaPlayer

/// Observes what stops playback from outside the app, without taking over handlers: nitro-player owns the
/// MPRemoteCommandCenter targets that act on the player; ours are additional targets that only report.
/// MPRemoteCommandCenter delivers each command to every target, so adding ours does not disturb nitro-player's.
public class AudioEventsModule: Module {
  private var tokens: [(MPRemoteCommand, Any)] = []
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AudioEvents")
    Events("onRemoteCommand", "onInterruption")

    /// Idempotent. Call after the player is configured: nitro-player clears targets only when it initialises.
    Function("start") {
      DispatchQueue.main.async { self.attach() }
    }

    OnDestroy {
      self.detach()
    }
  }

  private func attach() {
    detach()
    let cc = MPRemoteCommandCenter.shared()
    let commands: [(String, MPRemoteCommand)] = [
      ("pause", cc.pauseCommand), ("stop", cc.stopCommand), ("toggle", cc.togglePlayPauseCommand), ("play", cc.playCommand),
      ("next", cc.nextTrackCommand), ("previous", cc.previousTrackCommand),
    ]
    for (name, command) in commands {
      let token = command.addTarget { [weak self] _ in
        self?.sendEvent("onRemoteCommand", ["command": name])
        return .success
      }
      tokens.append((command, token))
    }
    observer = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
    ) { [weak self] n in
      guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        let type = AVAudioSession.InterruptionType(rawValue: raw)
      else { return }
      self?.sendEvent("onInterruption", ["phase": type == .began ? "began" : "ended"])
    }
  }

  private func detach() {
    for (command, token) in tokens { command.removeTarget(token) }
    tokens = []
    if let o = observer { NotificationCenter.default.removeObserver(o) }
    observer = nil
  }
}
