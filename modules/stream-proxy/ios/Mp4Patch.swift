import Foundation

/// AVFoundation double-counts duration for YouTube's fragmented m4a: the track's `mdhd` header
/// already carries the full duration AND the movie fragments add it again, so AVPlayer reports
/// ~2x the real length (end-of-track and seeking then misbehave). Zeroing `mdhd.duration` (as a
/// proper fragmented MP4 has it) fixes it. Verified with AVURLAsset: mdhd alone is sufficient;
/// zeroing mvhd/tkhd/elst as well is unnecessary.
/// Sizes are unchanged, so byte offsets and Content-Length stay valid.
enum Mp4Patch {
  private static let containers: Set<String> = ["moov", "trak", "mdia", "edts"]

  /// Patches `data` in place. `data` must start at file offset 0.
  static func zeroMediaDuration(_ data: inout Data) {
    let base = data.startIndex
    scan(&data, from: base, to: min(data.endIndex, base + 64 * 1024))
  }

  private static func u32(_ d: Data, _ i: Int) -> Int {
    return (Int(d[i]) << 24) | (Int(d[i + 1]) << 16) | (Int(d[i + 2]) << 8) | Int(d[i + 3])
  }

  private static func zero(_ d: inout Data, _ from: Int, _ count: Int) {
    guard from + count <= d.endIndex else { return }
    for i in from..<(from + count) { d[i] = 0 }
  }

  private static func scan(_ d: inout Data, from: Int, to end: Int) {
    var off = from
    while off + 8 <= end {
      let size = u32(d, off)
      guard size >= 8, off + size <= d.endIndex else { return }
      let type = String(decoding: d[(off + 4)..<(off + 8)], as: UTF8.self)
      let body = off + 8
      let version = body < d.endIndex ? d[body] : 0
      switch type {
      case "mdhd":
        // v0: ver/flags(4) created(4) modified(4) timescale(4) duration(4); v1: 8-byte times + 8-byte duration
        if version == 0 { zero(&d, body + 16, 4) } else { zero(&d, body + 24, 8) }
      default:
        if containers.contains(type) { scan(&d, from: body, to: off + size) }
      }
      off += size
    }
  }
}
