import AVFoundation
import Foundation

/// Tags and artwork of a local audio file (songs imported from Files or dropped into the Sangeet folder).
/// Never throws: a file AVFoundation cannot read comes back with empty fields and the JS side falls back to the file name.
enum AudioTags {
  static func read(path: String, artworkOut: String) async -> [String: Any] {
    var out: [String: Any] = ["hasArtwork": false]
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))

    if let d = try? await asset.load(.duration) {
      let s = CMTimeGetSeconds(d)
      if s.isFinite && s > 0 { out["durationSec"] = s }
    }

    // Common metadata covers ID3 (mp3) and iTunes (m4a/mp4). Some formats expose nothing there, so every other
    // available format (ID3, QuickTime, iTunes, ...) is read too and matched by its common key.
    var items: [AVMetadataItem] = (try? await asset.load(.commonMetadata)) ?? []
    if let all = try? await asset.load(.metadata) { items += all }
    if let formats = try? await asset.load(.availableMetadataFormats) {
      for f in formats {
        if let more = try? await asset.loadMetadata(for: f) { items += more }
      }
    }

    var title: String?
    var artist: String?
    var album: String?
    var art: Data?
    for item in items {
      guard let key = item.commonKey else { continue } // set already on items taken from a loaded asset
      switch key {
      case .commonKeyTitle where title == nil: title = await string(item)
      case .commonKeyArtist where artist == nil: artist = await string(item)
      case .commonKeyAlbumName where album == nil: album = await string(item)
      case .commonKeyArtwork where art == nil: art = await data(item)
      default: break
      }
    }
    if let t = title, !t.isEmpty { out["title"] = t }
    if let a = artist, !a.isEmpty { out["artist"] = a }
    if let a = album, !a.isEmpty { out["album"] = a }

    if let bytes = art, !bytes.isEmpty, !artworkOut.isEmpty {
      let url = URL(fileURLWithPath: artworkOut)
      try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      if (try? bytes.write(to: url, options: .atomic)) != nil { out["hasArtwork"] = true }
    }
    return out
  }

  private static func string(_ item: AVMetadataItem) async -> String? {
    if let s = try? await item.load(.stringValue) { return s.trimmingCharacters(in: .whitespacesAndNewlines) }
    return nil
  }

  /// Artwork arrives as raw image bytes (ID3 APIC, iTunes covr) or, in some containers, a dictionary holding them.
  private static func data(_ item: AVMetadataItem) async -> Data? {
    if let d = try? await item.load(.dataValue), !d.isEmpty { return d }
    if let v = try? await item.load(.value) {
      if let d = v as? Data { return d }
      if let dict = v as? [AnyHashable: Any], let d = dict["data"] as? Data { return d }
    }
    return nil
  }
}
