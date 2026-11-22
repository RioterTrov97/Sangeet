import Foundation

/// On-disk cache of whole songs (audio only): `<id>.m4a` / `<id>.webm` when complete, `<id>.<ext>.part` while downloading,
/// `<id>.playlist` the HLS byte-range playlist built for a finished song (so it plays with no network). Least recently used
/// songs (by modification date, touched when served) are deleted once the total passes `capBytes`. Kept in Application Support.
final class SongCache: @unchecked Sendable {
  let dir: URL
  private static let capKey = "StreamProxy.songCacheCapBytes"
  /// Remembered across launches, so the safety-net trim never runs against the 1 GB default before JS applies the setting.
  var capBytes: Int64 { didSet { UserDefaults.standard.set(NSNumber(value: capBytes), forKey: Self.capKey) } }
  private let fm = FileManager.default

  init(capBytes defaultCap: Int64) {
    capBytes = (UserDefaults.standard.object(forKey: Self.capKey) as? NSNumber)?.int64Value ?? defaultCap
    // Application Support, not Caches: iOS empties Caches whenever the device runs low on storage, which wiped every
    // automatically saved song at once. Excluded from iCloud backup (they can always be fetched again).
    let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    var d = base.appendingPathComponent("songs", isDirectory: true)
    try? fm.createDirectory(at: d, withIntermediateDirectories: true)
    var rv = URLResourceValues()
    rv.isExcludedFromBackup = true
    try? d.setResourceValues(rv)
    dir = d
    // Songs saved by earlier builds live in Caches/songs: move them over once.
    let old = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("songs", isDirectory: true)
    if fm.fileExists(atPath: old.path) {
      var moved = 0
      for f in (try? fm.contentsOfDirectory(at: old, includingPropertiesForKeys: nil)) ?? [] where f.pathExtension != "part" {
        let to = dir.appendingPathComponent(f.lastPathComponent)
        if !fm.fileExists(atPath: to.path), (try? fm.moveItem(at: f, to: to)) != nil { moved += 1 }
      }
      try? fm.removeItem(at: old)
      NSLog("[SongCache] moved %d file(s) out of Caches", moved)
    }
    for f in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where f.pathExtension == "part" {
      try? fm.removeItem(at: f)
    }
  }

  private func ext(_ mime: String) -> String { mime.contains("webm") ? "webm" : "m4a" }
  private func safe(_ id: String) -> String { String(id.map { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" ? $0 : "_" }) }

  func part(_ id: String, mime: String) -> URL { dir.appendingPathComponent("\(safe(id)).\(ext(mime)).part") }
  func playlistURL(_ id: String) -> URL { dir.appendingPathComponent("\(safe(id)).playlist") }

  func complete(_ id: String) -> URL? {
    for e in ["m4a", "webm"] {
      let u = dir.appendingPathComponent("\(safe(id)).\(e)")
      if let n = (try? fm.attributesOfItem(atPath: u.path))?[.size] as? NSNumber, n.int64Value > 0 { return u }
    }
    return nil
  }

  func touch(_ u: URL) { try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: u.path) }

  func finish(_ id: String, mime: String) -> Bool {
    let p = part(id, mime: mime)
    let d = dir.appendingPathComponent("\(safe(id)).\(ext(mime))")
    try? fm.removeItem(at: d)
    do { try fm.moveItem(at: p, to: d); touch(d); return true } catch { return false }
  }

  /// (id, bytes, last used) of every finished song.
  func list() -> [(String, Int64, Date)] {
    let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
    return ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys)) ?? []).filter { ["m4a", "webm"].contains($0.pathExtension) }.map { f in
      let v = try? f.resourceValues(forKeys: Set(keys))
      return (f.deletingPathExtension().lastPathComponent, Int64(v?.fileSize ?? 0), v?.contentModificationDate ?? .distantPast)
    }
  }

  func delete(_ id: String) {
    for e in ["m4a", "webm", "playlist"] { try? fm.removeItem(at: dir.appendingPathComponent("\(safe(id)).\(e)")) }
  }

  func clear() {
    for (id, _, _) in list() { delete(id) }
  }

  /// Safety net only: JS ranks songs by value and deletes them as soon as one finishes; this plain LRU runs when the cache is 25 % over budget anyway.
  func trim(protect: Set<String>) {
    let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
    let files = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys)) ?? []).filter { ["m4a", "webm"].contains($0.pathExtension) }
    let info = files.map { f -> (URL, Int64, Date) in
      let v = try? f.resourceValues(forKeys: Set(keys))
      return (f, Int64(v?.fileSize ?? 0), v?.contentModificationDate ?? .distantPast)
    }
    var total = info.reduce(Int64(0)) { $0 + $1.1 }
    let keep = Set(protect.map(safe))
    for (f, size, _) in info.sorted(by: { $0.2 < $1.2 }) {
      if capBytes <= 0 || total <= capBytes + capBytes / 4 { break }
      let name = f.deletingPathExtension().lastPathComponent
      if keep.contains(name) { continue }
      try? fm.removeItem(at: f)
      try? fm.removeItem(at: dir.appendingPathComponent("\(name).playlist"))
      total -= size
    }
  }
}
