import Foundation
import Network

struct ProxyStream {
  var url: URL
  var length: Int64
  var mime: String
  var userAgent: String
  /// Extra upstream headers (the backup server's bearer token).
  var headers: [String: String] = [:]
  /// Epoch seconds when the upstream URL expires (0 = unknown).
  var expiresAt: Double = 0
  /// DASH init segment and sidx byte ranges (inclusive), used to build the HLS playlist. -1 = unknown.
  var initStart: Int64 = -1
  var initEnd: Int64 = -1
  var indexStart: Int64 = -1
  var indexEnd: Int64 = -1
  /// Video streams only (used for the HLS master playlist).
  var codecs: String = ""
  var width: Int64 = 0
  var height: Int64 = 0
  var bitrate: Int64 = 0
}

enum ProxyError: Error { case startFailed(String), upstream(Int), badRequest, resolveFailed(String), noIndex }

/// Minimal HTTP/1.1 server on 127.0.0.1. Answers Range requests by fetching YouTube in growing
/// chunks (256 KB doubling up to 8 MB) because googlevideo throttles single requests over ~10 MB.
final class ProxyServer: @unchecked Sendable {
  static let shared = ProxyServer()

  private let queue = DispatchQueue(label: "sangeet.streamproxy")
  private let lock = NSLock()
  private var streams: [String: ProxyStream] = [:]
  private var playlists: [String: String] = [:]
  private var pending: [String: CheckedContinuation<ProxyStream, Error>] = [:]
  private var inflight: [String: Task<ProxyStream, Error>] = [:]
  /// Set by the Expo module: asks JS to resolve (videoId, requestId).
  var onResolveRequest: ((String, String, Bool) -> Void)?
  private static let portKey = "sangeet.streamproxy.port"
  private var listener: NWListener?
  private var port: UInt16 = 0
  private let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = 20
    c.timeoutIntervalForResource = 120
    c.httpMaximumConnectionsPerHost = 6
    return URLSession(configuration: c)
  }()

  /// Whole-song disk cache (1 GB LRU) and the songs being downloaded in full right now (id -> contiguous bytes written).
  let cache = SongCache(capBytes: 1024 * 1024 * 1024)
  /// A song finished downloading into the cache (JS then ranks and trims by value).
  var onCached: ((String) -> Void)?
  private var filling: [String: Int64] = [:]
  private var activeFills = 0
  /// Streams (by id) whose header-Range request for a later part 403'd: they use the `range=` query form and small chunks from then on.
  private var rangeQuery = Set<String>()
  /// Per-stream request counter sent as `rn` on /videoplayback requests.
  private var rnCounters: [String: Int] = [:]

  /// Network path (NWPathMonitor) and the dev "simulate offline" switch (set from JS); both guarded by `lock`.
  private var pathOnline = true
  private var simOffline = false
  private var monitor: NWPathMonitor?
  var simulateOffline: Bool {
    get { lock.lock(); defer { lock.unlock() }; return simOffline }
    set { lock.lock(); simOffline = newValue; lock.unlock() }
  }
  private func isOnline() -> Bool { lock.lock(); defer { lock.unlock() }; return pathOnline && !simOffline }

  private func startMonitor() {
    lock.lock()
    if monitor != nil { lock.unlock(); return }
    let m = NWPathMonitor()
    monitor = m
    lock.unlock()
    m.pathUpdateHandler = { [weak self] path in
      guard let self = self else { return }
      self.lock.lock(); self.pathOnline = path.status == .satisfied; self.lock.unlock()
    }
    m.start(queue: DispatchQueue(label: "sangeet.streamproxy.path"))
  }

  private static func isConnectivity(_ e: URLError) -> Bool {
    switch e.code {
    case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff,
         .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .timedOut: return true
    default: return false
    }
  }

  private func isRangeFlagged(_ id: String) -> Bool { lock.lock(); defer { lock.unlock() }; return rangeQuery.contains(id) }
  private func flagRange(_ id: String) { lock.lock(); rangeQuery.insert(id); lock.unlock() }
  private func nextRn(_ id: String) -> Int { lock.lock(); defer { lock.unlock() }; let n = (rnCounters[id] ?? 0) + 1; rnCounters[id] = n; return n }

  private static let minChunk: Int64 = 256 * 1024
  private static let maxChunk: Int64 = 8 * 1024 * 1024
  private static let fillChunkMin: Int64 = 1024 * 1024
  private static let fillChunkMax: Int64 = 2 * 1024 * 1024

  // MARK: Lifecycle

  func start() async throws -> UInt16 {
    startMonitor()
    lock.lock()
    if let l = listener, port != 0, l.state == .ready { lock.unlock(); return port }
    lock.unlock()
    // Reuse the last port when free so URLs handed out before a restart stay valid.
    let saved = UInt16(truncatingIfNeeded: UserDefaults.standard.integer(forKey: Self.portKey))
    if port == 0, saved != 0, let p = try? await launch(port: saved) { return p }
    return try await launch(port: port)
  }

  private func launch(port wanted: UInt16) async throws -> UInt16 {
    let params = NWParameters.tcp
    params.allowLocalEndpointReuse = true // rebinding the same port right after a restart
    params.requiredLocalEndpoint = NWEndpoint.hostPort(
      host: "127.0.0.1", port: wanted == 0 ? .any : NWEndpoint.Port(rawValue: wanted)!)
    let l = try NWListener(using: params)
    l.newConnectionHandler = { [weak self] conn in self?.handle(conn) }
    return try await withCheckedThrowingContinuation { cont in
      var resumed = false
      l.stateUpdateHandler = { [weak self] state in
        switch state {
        case .ready:
          if !resumed, let p = l.port?.rawValue {
            resumed = true
            self?.lock.lock(); self?.listener = l; self?.port = p; self?.lock.unlock()
            UserDefaults.standard.set(Int(p), forKey: Self.portKey)
            cont.resume(returning: p)
          }
        case .failed(let err):
          if !resumed { resumed = true; cont.resume(throwing: ProxyError.startFailed("\(err)")) }
          else {
            // Listener died later (e.g. after backgrounding): rebind to the same port so URLs stay valid.
            l.cancel()
            Task { [weak self] in
              guard let self = self else { return }
              try? await Task.sleep(nanoseconds: 300_000_000)
              _ = try? await self.launch(port: self.port)
            }
          }
        default: break
        }
      }
      l.start(queue: queue)
    }
  }

  /// Drops the listener and binds again on the same port (URLs already handed to the player stay valid). Used when JS
  /// finds the proxy not answering after the app sat suspended: iOS can reclaim the socket without the listener failing.
  func restart() async throws -> UInt16 {
    lock.lock(); let old = listener; listener = nil; let p = port; lock.unlock()
    old?.stateUpdateHandler = nil
    old?.cancel()
    try? await Task.sleep(nanoseconds: 150_000_000)
    if let bound = try? await launch(port: p) { return bound }
    try? await Task.sleep(nanoseconds: 500_000_000)
    return try await launch(port: p)
  }

  /// Stores an already-resolved stream (used by JS prefetch).
  func prime(id: String, stream: ProxyStream) {
    lock.lock(); streams[id] = stream; playlists.removeValue(forKey: id); lock.unlock()
    startFill(id, stream) // prefetched upcoming tracks are downloaded completely in the background
  }

  func unregister(id: String) {
    lock.lock(); streams.removeValue(forKey: id); playlists.removeValue(forKey: id); lock.unlock()
  }

  // MARK: Lazy resolution

  func fulfill(requestId: String, stream: ProxyStream) {
    lock.lock(); let c = pending.removeValue(forKey: requestId); lock.unlock()
    c?.resume(returning: stream)
  }

  func reject(requestId: String, reason: String) {
    lock.lock(); let c = pending.removeValue(forKey: requestId); lock.unlock()
    c?.resume(throwing: ProxyError.resolveFailed(reason))
  }

  private func requestFromJS(_ id: String, refresh: Bool) async throws -> ProxyStream {
    let rid = UUID().uuidString
    return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<ProxyStream, Error>) in
      lock.lock(); pending[rid] = cont; lock.unlock()
      NSLog("[StreamProxy] resolve request %@ (%@)", id, rid)
      onResolveRequest?(id, rid, refresh)
      queue.asyncAfter(deadline: .now() + 20) { [weak self] in self?.reject(requestId: rid, reason: "timeout") }
    }
  }

  /// Returns a usable stream for `id`, asking JS to resolve when unknown/expired (or when `staleURL`
  /// is the URL that just failed, so concurrent 403s trigger a single re-resolve).
  func resolve(_ id: String, staleURL: URL? = nil) async throws -> ProxyStream {
    lock.lock()
    if let s = streams[id], s.url != staleURL, s.expiresAt == 0 || s.expiresAt > Date().timeIntervalSince1970 + 60 {
      lock.unlock(); return s
    }
    if let t = inflight[id] { lock.unlock(); return try await t.value }
    let t = Task { try await self.requestFromJS(id, refresh: staleURL != nil) }
    inflight[id] = t
    lock.unlock()
    defer { lock.lock(); inflight.removeValue(forKey: id); lock.unlock() }
    let s = try await t.value
    prime(id: id, stream: s)
    return s
  }

  enum Route { case data(String), playlist(String), master(String) }

  /// Audio: `/v/<id>[.m3u8]`. Video-only adaptive: `/vv/<id>[.m3u8]` (key `v:<id>`). Muxed progressive: `/vx/<id>`
  /// (key `m:<id>`). Combined HLS master (video + audio group): `/vm/<id>.m3u8`.
  private func route(_ path: String) -> Route? {
    var name = path.split(separator: "?").first.map(String.init) ?? path
    var prefix = ""
    var master = false
    if name.hasPrefix("/vv/") { prefix = "v:"; name.removeFirst(4) }
    else if name.hasPrefix("/vx/") { prefix = "m:"; name.removeFirst(4) }
    else if name.hasPrefix("/vm/") { master = true; name.removeFirst(4) }
    else if name.hasPrefix("/v/") { name.removeFirst(3) }
    else { return nil }
    if name.hasSuffix(".m3u8") {
      let id = String(name.dropLast(5))
      return master ? .master(id) : .playlist(prefix + id)
    }
    if let dot = name.lastIndex(of: ".") { name = String(name[..<dot]) }
    return .data(prefix + name)
  }

  private func masterPlaylist(for id: String) async throws -> String {
    let v = try await resolve("v:" + id)
    let bw = max(v.bitrate, 500_000) + 130_000
    let codecs = v.codecs.isEmpty ? "avc1.4D401F,mp4a.40.2" : v.codecs + ",mp4a.40.2"
    let res = v.width > 0 && v.height > 0 ? ",RESOLUTION=\(v.width)x\(v.height)" : ""
    return "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n"
      + "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",NAME=\"Audio\",DEFAULT=YES,AUTOSELECT=YES,URI=\"/v/\(id).m3u8\"\n"
      + "#EXT-X-STREAM-INF:BANDWIDTH=\(bw)\(res),CODECS=\"\(codecs)\",AUDIO=\"aud\"\n/vv/\(id).m3u8\n"
  }

  // MARK: HLS (byte-range playlist over the DASH fragmented m4a)

  private func playlist(for id: String) async throws -> String {
    lock.lock(); let cached = playlists[id]; lock.unlock()
    if let c = cached { return c }
    if !id.contains(":"), cache.complete(id) != nil, let t = try? String(contentsOf: cache.playlistURL(id), encoding: .utf8) {
      lock.lock(); playlists[id] = t; lock.unlock()
      return t
    }
    // Prefetch-cached songs never got a .playlist: derive it from the file's own sidx so they play offline.
    if !id.contains(":"), let f = cache.complete(id), f.pathExtension != "webm", let t = HlsPlaylist.fromFile(f, uri: id) {
      lock.lock(); playlists[id] = t; lock.unlock()
      try? t.write(to: cache.playlistURL(id), atomically: true, encoding: .utf8)
      return t
    }
    let s = try await resolve(id)
    guard s.initEnd > 0, s.indexStart > 0, s.indexEnd > s.indexStart else { throw ProxyError.noIndex }
    let sidx = try await fetchChunk(id, from: s.indexStart, to: s.indexEnd)
    guard let text = HlsPlaylist.build(sidx: sidx, initStart: s.initStart, initEnd: s.initEnd, indexEnd: s.indexEnd, uri: id.split(separator: ":").last.map(String.init) ?? id) else { throw ProxyError.noIndex }
    lock.lock(); playlists[id] = text; lock.unlock()
    if !id.contains(":") { try? text.write(to: cache.playlistURL(id), atomically: true, encoding: .utf8) }
    return text
  }

  // MARK: Connection handling

  private func handle(_ conn: NWConnection) {
    conn.start(queue: queue)
    Task { [weak self] in
      guard let self = self else { return }
      defer { conn.cancel() }
      do {
        // Keep-alive loop: AVPlayer reuses the connection for successive Range requests.
        while true {
          guard let head = try await self.readHead(conn) else { return }
          try await self.respond(conn, head: head)
        }
      } catch {
        // Client went away or upstream failed: just drop the connection.
      }
    }
  }

  private func readHead(_ conn: NWConnection) async throws -> String? {
    var buf = Data()
    let terminator = Data("\r\n\r\n".utf8)
    while buf.range(of: terminator) == nil {
      if buf.count > 64 * 1024 { throw ProxyError.badRequest }
      let chunk: Data? = try await withCheckedThrowingContinuation { cont in
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, isComplete, err in
          if let err = err { cont.resume(throwing: err) }
          else if let data = data, !data.isEmpty { cont.resume(returning: data) }
          else if isComplete { cont.resume(returning: nil) }
          else { cont.resume(returning: Data()) }
        }
      }
      guard let c = chunk else { return nil }
      buf.append(c)
    }
    return String(decoding: buf, as: UTF8.self)
  }

  private func send(_ conn: NWConnection, _ data: Data) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      conn.send(content: data, completion: .contentProcessed { err in
        if let err = err { cont.resume(throwing: err) } else { cont.resume() }
      })
    }
  }

  private func respond(_ conn: NWConnection, head: String) async throws {
    let lines = head.components(separatedBy: "\r\n")
    let first = lines.first?.split(separator: " ").map(String.init) ?? []
    guard first.count >= 2 else { throw ProxyError.badRequest }
    let method = first[0], path = first[1]
    var rangeHeader: String?
    for l in lines.dropFirst() {
      let kv = l.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
      if kv.count == 2, kv[0].lowercased() == "range" { rangeHeader = kv[1] }
    }
    guard let r = route(path) else {
      try await send(conn, Data("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8))
      throw ProxyError.badRequest
    }
    var id = ""
    var isPlaylist = false
    var isMaster = false
    switch r {
    case .data(let k): id = k
    case .playlist(let k): id = k; isPlaylist = true
    case .master(let k): id = k; isPlaylist = true; isMaster = true
    }
    if isPlaylist {
      do {
        let body = Data(try await (isMaster ? masterPlaylist(for: id) : playlist(for: id)).utf8)
        NSLog("[StreamProxy] %@ %@ -> playlist %dB", method, path, body.count)
        let h = "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: \(body.count)\r\nConnection: keep-alive\r\n\r\n"
        try await send(conn, Data(h.utf8) + (method == "HEAD" ? Data() : body))
      } catch {
        NSLog("[StreamProxy] playlist %@ failed: %@", id, "\(error)")
        try await send(conn, Data("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8))
        throw error
      }
      return
    }
    if !id.contains(":"), let f = cache.complete(id) {
      try await serveFile(conn, method: method, path: path, range: rangeHeader, file: f)
      return
    }
    let s: ProxyStream
    do { s = try await resolve(id) } catch {
      NSLog("[StreamProxy] resolve %@ failed: %@", id, "\(error)")
      try await send(conn, Data("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8))
      throw error
    }
    startFill(id, s)
    let (start, end, partial) = Self.parseRange(rangeHeader, length: s.length)
    let t0 = Date()
    NSLog("[StreamProxy] %@ %@ range=%@ -> %lld-%lld", method, path, rangeHeader ?? "-", start, end)
    if start > end || start >= s.length {
      try await send(conn, Data("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */\(s.length)\r\nContent-Length: 0\r\n\r\n".utf8))
      return
    }
    var h = partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n"
    h += "Content-Type: \(s.mime)\r\nAccept-Ranges: bytes\r\nContent-Length: \(end - start + 1)\r\n"
    if partial { h += "Content-Range: bytes \(start)-\(end)/\(s.length)\r\n" }
    h += "Connection: keep-alive\r\n\r\n"
    try await send(conn, Data(h.utf8))
    if method == "HEAD" { return }

    // Fetch growing chunks (256 KB doubling to 8 MB), keeping up to `depth` fetches in flight so the
    // next chunks are already downloading while the current one is written to the player.
    let depth = 3
    var nextFetch = start
    var size = Self.minChunk
    var queue: [Task<Data, Error>] = []
    defer { queue.forEach { $0.cancel() } }
    func fill() {
      while queue.count < depth && nextFetch <= end {
        let from = nextFetch, to = min(from + size - 1, end)
        queue.append(Task {
          if let d = try self.fromPartial(id, from: from, to: to) { return d }
          return try await self.fetchChunk(id, from: from, to: to)
        })
        nextFetch = to + 1
        size = min(size * 2, RangePlan.chunkCap(flagged: isRangeFlagged(id), normal: Self.maxChunk))
      }
    }
    fill()
    var isFirstChunk = true
    while !queue.isEmpty {
      var data = try await queue.removeFirst().value
      if data.isEmpty { throw ProxyError.upstream(0) }
      fill()
      if isFirstChunk && start == 0 && s.mime.contains("mp4") && !id.contains(":") { Mp4Patch.zeroMediaDuration(&data) }
      isFirstChunk = false
      try await send(conn, data)
    }
    NSLog("[StreamProxy] done %lld-%lld in %.0fms", start, end, Date().timeIntervalSince(t0) * 1000)
  }

  /// Serves a fully cached song for the request's Range without touching the network.
  private func serveFile(_ conn: NWConnection, method: String, path: String, range: String?, file: URL) async throws {
    let len = ((try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? NSNumber)?.int64Value ?? 0
    let (start, end, partial) = Self.parseRange(range, length: len)
    NSLog("[StreamProxy] %@ %@ range=%@ -> %lld-%lld (cache)", method, path, range ?? "-", start, end)
    if start > end || start >= len {
      try await send(conn, Data("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */\(len)\r\nContent-Length: 0\r\n\r\n".utf8))
      return
    }
    let mime = file.pathExtension == "webm" ? "audio/webm" : "audio/mp4"
    var h = partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n"
    h += "Content-Type: \(mime)\r\nAccept-Ranges: bytes\r\nContent-Length: \(end - start + 1)\r\n"
    if partial { h += "Content-Range: bytes \(start)-\(end)/\(len)\r\n" }
    h += "Connection: keep-alive\r\n\r\n"
    try await send(conn, Data(h.utf8))
    if method == "HEAD" { return }
    cache.touch(file)
    let fh = try FileHandle(forReadingFrom: file)
    defer { try? fh.close() }
    try fh.seek(toOffset: UInt64(start))
    var left = end - start + 1
    while left > 0 {
      guard let d = try fh.read(upToCount: Int(min(256 * 1024, left))), !d.isEmpty else { throw ProxyError.upstream(0) }
      try await send(conn, d)
      left -= Int64(d.count)
    }
  }

  /// Bytes the background filler already wrote, when the whole range is there.
  private func fromPartial(_ id: String, from: Int64, to: Int64) throws -> Data? {
    lock.lock(); let have = filling[id]; let mime = streams[id]?.mime ?? ""; lock.unlock()
    guard let h = have, to < h, let fh = try? FileHandle(forReadingFrom: cache.part(id, mime: mime)) else { return nil }
    defer { try? fh.close() }
    try fh.seek(toOffset: UInt64(from))
    guard let d = try fh.read(upToCount: Int(to - from + 1)), Int64(d.count) == to - from + 1 else { return nil }
    return d
  }

  /// Downloads the whole of `id` in 1-2 MB chunks into the cache (one background download per song, at most three at a
  /// time). Every chunk goes through `fetchChunk`, so a 403/expired URL is re-resolved and the download continues from the
  /// same byte. The file only becomes visible to `cache.complete` once every byte is there.
  private func startFill(_ id: String, _ s: ProxyStream) {
    guard cache.capBytes > 0, !id.contains(":"), s.length > 0, cache.complete(id) == nil else { return }
    lock.lock()
    if filling[id] != nil { lock.unlock(); return }
    filling[id] = 0
    lock.unlock()
    Task.detached(priority: .utility) { [self] in
      var ok = false
      defer {
        lock.lock(); filling.removeValue(forKey: id); let others = Set(filling.keys); lock.unlock()
        if ok { cache.trim(protect: others.union([id])); onCached?(id) }
      }
      while true {
        lock.lock(); let busy = activeFills >= 3; if !busy { activeFills += 1 }; lock.unlock()
        if !busy { break }
        try? await Task.sleep(nanoseconds: 1_000_000_000)
      }
      defer { lock.lock(); activeFills -= 1; lock.unlock() }
      let part = cache.part(id, mime: s.mime)
      do {
        try? FileManager.default.removeItem(at: part)
        guard FileManager.default.createFile(atPath: part.path, contents: nil) else { throw ProxyError.upstream(0) }
        let fh = try FileHandle(forWritingTo: part)
        defer { try? fh.close() }
        var pos: Int64 = 0
        var size = Self.fillChunkMin
        while pos < s.length {
          let to = min(pos + size - 1, s.length - 1)
          var data = try await fetchChunk(id, from: pos, to: to)
          if pos == 0 && s.mime.contains("mp4") { Mp4Patch.zeroMediaDuration(&data) }
          try fh.seek(toOffset: UInt64(pos))
          try fh.write(contentsOf: data)
          pos = to + 1
          lock.lock(); filling[id] = pos; lock.unlock()
          size = RangePlan.chunkCap(flagged: isRangeFlagged(id), normal: Self.fillChunkMax)
        }
        try fh.synchronize()
        ok = cache.finish(id, mime: s.mime)
        NSLog("[StreamProxy] cached %@ (%lld bytes)", id, s.length)
      } catch {
        NSLog("[StreamProxy] background download of %@ stopped: %@", id, "\(error)")
        try? FileManager.default.removeItem(at: part)
      }
    }
  }

  static func parseRange(_ header: String?, length: Int64) -> (Int64, Int64, Bool) {
    guard let header = header, header.lowercased().hasPrefix("bytes=") else { return (0, length - 1, false) }
    let spec = header.dropFirst(6).split(separator: ",").first.map(String.init) ?? ""
    let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 2 else { return (0, length - 1, false) }
    if parts[0].isEmpty, let n = Int64(parts[1]) { return (max(0, length - n), length - 1, true) }
    guard let a = Int64(parts[0]) else { return (0, length - 1, false) }
    let b = Int64(parts[1]).map { min($0, length - 1) } ?? (length - 1)
    return (a, b, true)
  }

  // MARK: Upstream

  /// True when `bytes=0-1` on this URL answers 206/200: the URL itself is valid.
  private func probeStart(_ s: ProxyStream) async -> Bool {
    if simulateOffline { return false }
    var req = URLRequest(url: s.url)
    req.setValue("bytes=0-1", forHTTPHeaderField: "Range")
    req.setValue(s.userAgent, forHTTPHeaderField: "User-Agent")
    req.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
    req.setValue("https://www.youtube.com/", forHTTPHeaderField: "Referer")
    for (k, v) in s.headers { req.setValue(v, forHTTPHeaderField: k) }
    guard let (_, resp) = try? await session.data(for: req), let code = (resp as? HTTPURLResponse)?.statusCode else { return false }
    return code == 206 || code == 200
  }

  private func fetchChunk(_ id: String, from: Int64, to wanted: Int64) async throws -> Data {
    var s = try await resolve(id)
    let to = RangePlan.boundedTo(from: from, to: wanted, length: s.length)
    var refreshed = false
    var flipped = false
    var lastError: Error = ProxyError.upstream(0)
    var tries = 0
    var waited = 0.0 // seconds spent waiting for the network to come back
    var waiting = false
    var waits = 0
    while tries < 3 {
      try Task.checkCancellation()
      tries += 1
      // Header Range, unless this stream has already 403'd on one for a later part: then the `range=` query form (bounded, never open-ended).
      let query = RangePlan.useQueryForm(from: from, flagged: isRangeFlagged(id))
      let base = query ? RangePlan.withQueryRange(s.url, from: from, to: to) : s.url
      var req = URLRequest(url: RangePlan.withRn(base, nextRn(id)))
      if !query { req.setValue("bytes=\(from)-\(to)", forHTTPHeaderField: "Range") }
      req.setValue(s.userAgent, forHTTPHeaderField: "User-Agent")
      req.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
      req.setValue("https://www.youtube.com/", forHTTPHeaderField: "Referer")
      for (k, v) in s.headers { req.setValue(v, forHTTPHeaderField: k) }
      do {
        let tf = Date()
        if simulateOffline { throw URLError(.notConnectedToInternet) }
        let (data, resp) = try await session.data(for: req)
        if waiting { waiting = false; NSLog("[StreamProxy] network back, %@ %lld-%lld resumed after %.0fs", id, from, to, waited) }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        NSLog("[StreamProxy] upstream %@ %lld-%lld try=%d form=%@ status=%d %dB in %.0fms", id, from, to, tries, query ? "query" : "header", code, data.count, Date().timeIntervalSince(tf) * 1000)
        if code == 206 || (code == 200 && Int64(data.count) == to - from + 1) { return data }
        if code == 200 && from == 0 { return data.prefix(Int(to - from + 1)) }
        // Some googlevideo edges refuse a header Range for a later part with 403 although the URL is fine. If a fresh 0-1 probe on the
        // SAME url is served, remember it for this stream (query form and 1 MiB chunks from now on) and retry once that way. This must not
        // go through the re-resolve path (no resolve loops); a second refusal surfaces as an upstream error.
        if code == 403 && from > 0 && !query && !flipped, await probeStart(s) {
          flipped = true
          flagRange(id)
          NSLog("[proxy] range-403 %@ %lld-%lld: probe 0-1 is served, using the range= query form for this stream", id, from, to)
          continue
        }
        if (code == 403 || code == 410) && !refreshed && !flipped {
          // Expired/blocked URL: ask JS for a fresh one (once) and retry.
          refreshed = true
          s = try await resolve(id, staleURL: s.url)
          tries = 0
          continue
        }
        lastError = ProxyError.upstream(code)
      } catch let e as ProxyError {
        throw e
      } catch let e as URLError where Self.isConnectivity(e) {
        // Hold instead of failing: AVPlayer stalls (rather than skipping a half-sent segment) and the fill continues when the network returns.
        if waited >= 600 { throw e }
        if !waiting { waiting = true; NSLog("[StreamProxy] network down, %@ %lld-%lld waiting (%@)", id, from, to, "\(e.code.rawValue)") }
        tries -= 1
        let backoff = [1.0, 2.0, 4.0, 8.0, 15.0][min(waits, 4)]
        waits += 1
        var sawOffline = !isOnline()
        var slept = 0.0
        while slept < backoff && waited < 600 {
          try await Task.sleep(nanoseconds: 500_000_000)
          slept += 0.5; waited += 0.5
          let on = isOnline()
          if !on { sawOffline = true } else if sawOffline { break }
        }
      } catch {
        lastError = error
      }
    }
    throw lastError
  }
}
