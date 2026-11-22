import Foundation

/// Byte-range HLS playlist over a DASH fragmented m4a (pure, so tests/main.swift can compile it).
enum HlsPlaylist {
  static func build(sidx d: Data, initStart: Int64, initEnd: Int64, indexEnd: Int64, uri: String) -> String? {
    let b = d.startIndex
    func u32(_ i: Int) -> Int64 { Int64(d[b + i]) << 24 | Int64(d[b + i + 1]) << 16 | Int64(d[b + i + 2]) << 8 | Int64(d[b + i + 3]) }
    guard d.count >= 32, String(decoding: d[(b + 4)..<(b + 8)], as: UTF8.self) == "sidx" else { return nil }
    let version = d[b + 8]
    let timescale = u32(16)
    var off = 20
    var firstOffset: Int64
    if version == 0 { firstOffset = u32(off + 4); off += 8 } else { firstOffset = u32(off + 12); off += 16 }
    off += 2
    let count = Int(Int64(d[b + off]) << 8 | Int64(d[b + off + 1])); off += 2
    guard timescale > 0, d.count >= off + count * 12 else { return nil }
    var pos = indexEnd + 1 + firstOffset
    var segs: [(Int64, Int64, Double)] = []
    for i in 0..<count {
      let size = u32(off + i * 12) & 0x7FFF_FFFF
      let dur = Double(u32(off + i * 12 + 4)) / Double(timescale)
      segs.append((pos, size, dur))
      pos += size
    }
    let target = Int(ceil(segs.map { $0.2 }.max() ?? 5))
    var out = "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:\(target)\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-INDEPENDENT-SEGMENTS\n"
    out += "#EXT-X-MAP:URI=\"\(uri)\",BYTERANGE=\"\(initEnd - initStart + 1)@\(initStart)\"\n"
    for (p, size, dur) in segs {
      out += "#EXTINF:\(String(format: "%.5f", dur)),\n#EXT-X-BYTERANGE:\(size)@\(p)\n\(uri)\n"
    }
    out += "#EXT-X-ENDLIST\n"
    return out
  }

  /// Playlist for a fully cached m4a, from its own top-level boxes (init = everything before the first `sidx`). Nil for webm / no sidx.
  static func fromFile(_ file: URL, uri: String) -> String? {
    guard file.pathExtension != "webm", let fh = try? FileHandle(forReadingFrom: file) else { return nil }
    defer { try? fh.close() }
    guard let total = try? fh.seekToEnd() else { return nil }
    var o: UInt64 = 0
    while o + 8 <= total {
      guard (try? fh.seek(toOffset: o)) != nil, let h = try? fh.read(upToCount: 16), h.count >= 8 else { return nil }
      let b = h.startIndex
      var n = UInt64(h[b]) << 24 | UInt64(h[b + 1]) << 16 | UInt64(h[b + 2]) << 8 | UInt64(h[b + 3])
      let type = String(decoding: h[(b + 4)..<(b + 8)], as: UTF8.self)
      if n == 1 {
        guard h.count >= 16 else { return nil }
        n = 0
        for i in 8..<16 { n = n << 8 | UInt64(h[b + i]) }
      }
      guard n >= 8, n <= total - o else { return nil } // size 0 (to EOF), bogus or overflowing: stop
      if type == "sidx" {
        guard o > 0, n <= 1 << 20, (try? fh.seek(toOffset: o)) != nil, let box = try? fh.read(upToCount: Int(n)), box.count == Int(n) else { return nil }
        return build(sidx: box, initStart: 0, initEnd: Int64(o) - 1, indexEnd: Int64(o + n) - 1, uri: uri)
      }
      o += n
    }
    return nil
  }
}
