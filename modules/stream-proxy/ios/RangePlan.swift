import Foundation

/// Pure decisions for upstream range requests (kept free of state and networking so they can be checked on their own; the Kotlin twin is
/// android/.../RangePlan.kt and must behave identically). Behaviour as in yt-dlp and NewPipe: googlevideo clients that answer a header
/// `Range` for a later part of the file with 403 are served by the `&range=a-b` query form instead, in bounded chunks.
enum RangePlan {
  /// Largest chunk for a stream that has shown the later-range 403.
  static let flaggedMaxChunk: Int64 = 1024 * 1024

  /// A later part (from > 0) of a stream that already 403'd on a header range goes straight to the query form.
  static func useQueryForm(from: Int64, flagged: Bool) -> Bool { flagged && from > 0 }

  static func chunkCap(flagged: Bool, normal: Int64) -> Int64 { flagged ? min(normal, flaggedMaxChunk) : normal }

  /// Never open-ended: `to` is clamped to the known content length.
  static func boundedTo(from: Int64, to: Int64, length: Int64) -> Int64 {
    let t = length > 0 ? min(to, length - 1) : to
    return max(from, t)
  }

  /// `url` with `range=from-to` (an existing `range` is replaced).
  static func withQueryRange(_ url: URL, from: Int64, to: Int64) -> URL {
    guard var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
    var items = (c.queryItems ?? []).filter { $0.name != "range" }
    items.append(URLQueryItem(name: "range", value: "\(from)-\(to)"))
    c.queryItems = items
    return c.url ?? url
  }

  /// `url` with `rn=<n>` (the request counter NewPipe sends) for /videoplayback URLs only; others are returned unchanged.
  static func withRn(_ url: URL, _ n: Int) -> URL {
    guard url.path.contains("videoplayback"), var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
    var items = (c.queryItems ?? []).filter { $0.name != "rn" }
    items.append(URLQueryItem(name: "rn", value: "\(n)"))
    c.queryItems = items
    return c.url ?? url
  }
}
