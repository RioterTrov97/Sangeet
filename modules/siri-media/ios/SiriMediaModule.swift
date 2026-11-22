import ExpoModulesCore
import Intents

/// Native side of Siri media intents. `INPlayMediaIntent`s arrive in the app delegate (see plugin/index.js, which adds
/// `application(_:handle:completionHandler:)`; Expo's AppDelegateSubscriber does not forward INIntent selectors) and go
/// through `SiriIntentBridge`: queued here until JS has registered its listener, then delivered as an `onIntent` event.
public final class SiriIntentBridge {
  public static let shared = SiriIntentBridge()

  private var queue: [(id: String, payload: String)] = []
  private var completions: [String: (INIntentResponse) -> Void] = [:]
  private var ready = false
  /// Set by the module when it is created; sends the event to JS.
  var sink: ((String, String) -> Void)?

  /// Called by the app delegate for a real intent.
  public func handle(_ intent: INIntent, completion: @escaping (INIntentResponse) -> Void) {
    guard let play = intent as? INPlayMediaIntent else {
      completion(INPlayMediaIntentResponse(code: .failure, userActivity: nil))
      return
    }
    enqueue(payload: Self.serialize(play), completion: completion)
  }

  func enqueue(payload: String, completion: ((INIntentResponse) -> Void)?) {
    DispatchQueue.main.async {
      let id = UUID().uuidString
      if let completion = completion {
        self.completions[id] = completion
        // Siri needs an answer within a few seconds. If JS has not finished the real work by then, say yes:
        // the app is launched and will still start playback when JS gets to the queued intent.
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self.finish(id, code: "success") }
      }
      if self.ready, let sink = self.sink { sink(id, payload) } else { self.queue.append((id, payload)) }
    }
  }

  func setReady() {
    DispatchQueue.main.async {
      self.ready = true
      let pending = self.queue
      self.queue = []
      for item in pending { self.sink?(item.id, item.payload) }
    }
  }

  func finish(_ id: String, code: String) {
    DispatchQueue.main.async {
      guard let completion = self.completions.removeValue(forKey: id) else { return }
      let mapped: INPlayMediaIntentResponseCode
      switch code {
      case "success": mapped = .success
      case "failureNoMatch": mapped = .failureUnknownMediaType
      case "failureUnsupported": mapped = .failureUnknownMediaType
      default: mapped = .failure
      }
      completion(INPlayMediaIntentResponse(code: mapped, userActivity: nil))
    }
  }

  static func serialize(_ intent: INPlayMediaIntent) -> String {
    var out: [String: Any] = [:]
    let search = intent.mediaSearch
    var name = search?.mediaName
    if name == nil { name = intent.mediaItems?.first?.title }
    if let name = name { out["mediaName"] = name }
    if let artist = search?.artistName ?? intent.mediaItems?.first?.artist { out["artistName"] = artist }
    if let album = search?.albumName { out["albumName"] = album }
    if let genres = search?.genreNames, !genres.isEmpty { out["genreNames"] = genres }
    if let moods = search?.moodNames, !moods.isEmpty { out["moodNames"] = moods }
    let type = search?.mediaType ?? intent.mediaItems?.first?.type ?? .unknown
    switch type {
    case .song: out["mediaType"] = "song"
    case .album: out["mediaType"] = "album"
    case .artist: out["mediaType"] = "artist"
    case .playlist: out["mediaType"] = "playlist"
    case .genre: out["mediaType"] = "genre"
    case .music: out["mediaType"] = "music"
    case .musicStation, .algorithmicRadioStation, .radioStation, .station: out["mediaType"] = "station"
    default: out["mediaType"] = "unknown"
    }
    if let ref = search?.reference {
      switch ref {
      case .currentlyPlaying: out["reference"] = "currentlyPlaying"
      case .my: out["reference"] = "my"
      default: out["reference"] = "unknown"
      }
    }
    if let shuffled = intent.playShuffled { out["playShuffled"] = shuffled }
    switch intent.playbackRepeatMode {
    case .all: out["repeat"] = "all"
    case .one: out["repeat"] = "one"
    case .none: out["repeat"] = "none"
    default: break
    }
    switch intent.playbackQueueLocation {
    case .next: out["queueLocation"] = "next"
    case .later: out["queueLocation"] = "later"
    case .now: out["queueLocation"] = "now"
    default: break
    }
    let data = (try? JSONSerialization.data(withJSONObject: out)) ?? Data("{}".utf8)
    return String(data: data, encoding: .utf8) ?? "{}"
  }
}

public class SiriMediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SiriMedia")
    Events("onIntent")

    OnCreate {
      SiriIntentBridge.shared.sink = { [weak self] id, payload in
        self?.sendEvent("onIntent", ["id": id, "payload": payload])
      }
    }

    Function("ready") { SiriIntentBridge.shared.setReady() }

    Function("complete") { (id: String, code: String) in SiriIntentBridge.shared.finish(id, code: code) }

    Function("inject") { (payload: String) in SiriIntentBridge.shared.enqueue(payload: payload, completion: nil) }

    Function("setVocabulary") { (playlists: [String], artists: [String]) in
      // Without the com.apple.developer.siri entitlement (free-team builds) INVocabulary throws and aborts the app.
      guard Bundle.main.object(forInfoDictionaryKey: "SangeetSiriEntitled") as? Bool == true else { return }
      let vocab = INVocabulary.shared()
      vocab.setVocabularyStrings(NSOrderedSet(array: playlists), of: .mediaPlaylistTitle)
      vocab.setVocabularyStrings(NSOrderedSet(array: artists), of: .mediaMusicArtistName)
    }
  }
}
