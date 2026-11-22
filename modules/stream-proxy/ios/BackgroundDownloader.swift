import Foundation

/// Downloads track audio with a background URLSession so transfers continue while iOS has the app suspended.
///
/// YouTube throttles un-ranged requests to ~30 KB/s but serves explicit byte ranges at full speed, so each file is
/// split into `chunkSize` Range tasks that are all scheduled at once. A finished chunk is written into
/// `<id>.m4a.part` at its offset and recorded in a small JSON manifest (`<id>.bg.json`), which is what makes a
/// download resumable across URL expiry (JS re-resolves and calls `start` again) and across app relaunches.
/// When every chunk is in, `mdhd.duration` is zeroed (same patch the stream proxy applies) and the file is renamed.
final class BackgroundDownloader: NSObject, URLSessionDownloadDelegate, URLSessionDelegate, @unchecked Sendable {
  static let shared = BackgroundDownloader()
  static let sessionId = (Bundle.main.bundleIdentifier ?? "sangeet") + ".bgdownload"
  static let chunkSize: Int64 = 4 * 1024 * 1024

  struct Manifest: Codable {
    var id: String
    var url: String
    var headers: [String: String]
    var userAgent: String
    var total: Int64
    var chunk: Int64
    var done: [Int]
    var partPath: String
    var destPath: String
    var finished: Bool = false
  }

  /// JS callbacks (set by the Expo module while JS is alive).
  var onProgress: ((String, Int64, Int64) -> Void)?
  var onDone: ((String, Int64) -> Void)?
  var onFailed: ((String, String, Bool) -> Void)?
  var backgroundCompletion: (() -> Void)?

  private let lock = NSLock()
  private var manifests: [String: Manifest] = [:]
  private var failed: [String: (String, Bool)] = [:]
  private lazy var session: URLSession = {
    let c = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
    c.isDiscretionary = false
    c.sessionSendsLaunchEvents = true
    c.httpMaximumConnectionsPerHost = 3
    c.timeoutIntervalForResource = 60 * 60 * 24
    return URLSession(configuration: c, delegate: self, delegateQueue: nil)
  }()

  private static func manifestURL(_ partPath: String) -> URL { URL(fileURLWithPath: partPath + ".bg.json") }

  /// Touching `session` re-attaches to tasks that kept running while the app was suspended or terminated.
  func attach() { _ = session }

  // MARK: JS API

  /// (Re)starts a download. Chunks already on disk (from the manifest) are kept; only the rest are scheduled.
  func start(id: String, url: String, headers: [String: String], userAgent: String, total: Int64, partPath: String, destPath: String) {
    lock.lock()
    var m = Self.load(partPath)
    if m == nil || m!.total != total || m!.finished || !FileManager.default.fileExists(atPath: partPath) {
      try? FileManager.default.removeItem(atPath: partPath)
      FileManager.default.createFile(atPath: partPath, contents: nil)
      m = Manifest(id: id, url: url, headers: headers, userAgent: userAgent, total: total, chunk: Self.chunkSize, done: [], partPath: partPath, destPath: destPath)
    }
    m!.url = url
    m!.headers = headers
    m!.userAgent = userAgent
    manifests[id] = m
    failed[id] = nil
    Self.save(m!)
    let snapshot = m!
    lock.unlock()
    session.getAllTasks { [weak self] tasks in
      guard let self = self else { return }
      let running = Set(tasks.filter { $0.state == .running || $0.state == .suspended }.compactMap { t -> Int? in
        let p = (t.taskDescription ?? "").split(separator: "|")
        return p.count == 2 && String(p[0]) == id ? Int(p[1]) : nil
      })
      // Tasks from before a URL refresh would 403: cancel them and reschedule against the new URL.
      for t in tasks where (t.taskDescription ?? "").hasPrefix(id + "|") { t.cancel() }
      _ = running
      let n = Int((snapshot.total + snapshot.chunk - 1) / snapshot.chunk)
      var any = false
      for i in 0..<n where !snapshot.done.contains(i) {
        any = true
        self.schedule(snapshot, index: i)
      }
      if !any { self.finish(id) }
    }
  }

  func cancel(id: String) {
    session.getAllTasks { tasks in for t in tasks where (t.taskDescription ?? "").hasPrefix(id + "|") { t.cancel() } }
    lock.lock()
    if let m = manifests.removeValue(forKey: id) {
      try? FileManager.default.removeItem(at: Self.manifestURL(m.partPath))
    }
    failed[id] = nil
    lock.unlock()
  }

  /// State of every download this process knows about (JS polls this after the app resumes).
  func status() -> [[String: Any]] {
    lock.lock(); defer { lock.unlock() }
    return manifests.values.map { m in
      let bytes = min(m.total, Int64(m.done.count) * m.chunk)
      var d: [String: Any] = ["id": m.id, "bytes": bytes, "total": m.total, "state": m.finished ? "done" : "running"]
      if let f = failed[m.id] { d["state"] = "failed"; d["error"] = f.0; d["needsResolve"] = f.1 }
      return d
    }
  }

  // MARK: Scheduling

  /// Chunks whose 403 was already retried once with the `range=` query form (see `urlSession(_:downloadTask:didFinishDownloadingTo:)`).
  private var rangeRetried = Set<String>()

  private func schedule(_ m: Manifest, index i: Int, queryRange: Bool = false) {
    guard var url = URL(string: m.url) else { return }
    let from = Int64(i) * m.chunk
    let to = min(from + m.chunk, m.total) - 1
    if queryRange, var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
      var items = (comps.queryItems ?? []).filter { $0.name != "range" }
      items.append(URLQueryItem(name: "range", value: "\(from)-\(to)"))
      comps.queryItems = items
      url = comps.url ?? url
    }
    var req = URLRequest(url: url)
    if !queryRange { req.setValue("bytes=\(from)-\(to)", forHTTPHeaderField: "Range") }
    req.setValue(m.userAgent, forHTTPHeaderField: "User-Agent")
    req.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
    req.setValue("https://www.youtube.com/", forHTTPHeaderField: "Referer")
    for (k, v) in m.headers { req.setValue(v, forHTTPHeaderField: k) }
    let task = session.downloadTask(with: req)
    task.taskDescription = "\(m.id)|\(i)"
    task.resume()
  }

  // MARK: Delegate

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    let p = (downloadTask.taskDescription ?? "").split(separator: "|")
    guard p.count == 2, let index = Int(p[1]) else { return }
    let id = String(p[0])
    lock.lock()
    guard var m = manifests[id] ?? Self.loadById(id) else { lock.unlock(); return }
    manifests[id] = m
    lock.unlock()
    let code = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
    let from = Int64(index) * m.chunk
    let want = min(from + m.chunk, m.total) - from
    let size = (try? FileManager.default.attributesOfItem(atPath: location.path)[.size] as? Int64) ?? 0
    // A mid-file chunk refused with 403 on a URL that otherwise works (edge refuses non-zero-start ranges): retry that
    // chunk once with the `range=` query form instead of failing the download or re-resolving.
    lock.lock()
    let firstRefusal = code == 403 && from > 0 && rangeRetried.insert("\(id)|\(index)").inserted
    lock.unlock()
    if firstRefusal {
      NSLog("[downloads] range-403 %@ chunk %d: retrying once with range= query", id, index)
      schedule(m, index: index, queryRange: true)
      return
    }
    guard code == 206 || (code == 200 && from == 0), size == want else {
      fail(id, "chunk \(index) HTTP \(code) \(size)/\(want)B", needsResolve: code == 403 || code == 410)
      return
    }
    do {
      let h = try FileHandle(forWritingTo: URL(fileURLWithPath: m.partPath))
      defer { try? h.close() }
      try h.seek(toOffset: UInt64(from))
      try h.write(contentsOf: try Data(contentsOf: location, options: .mappedIfSafe))
    } catch {
      fail(id, "write failed: \(error.localizedDescription)", needsResolve: false)
      return
    }
    lock.lock()
    if !m.done.contains(index) { m.done.append(index) }
    manifests[id] = m
    Self.save(m)
    let doneCount = m.done.count
    let chunks = Int((m.total + m.chunk - 1) / m.chunk)
    lock.unlock()
    onProgress?(id, min(m.total, Int64(doneCount) * m.chunk), m.total)
    if doneCount >= chunks { finish(id) }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let error = error as NSError?, error.code != NSURLErrorCancelled else { return }
    let id = String((task.taskDescription ?? "").split(separator: "|").first ?? "")
    if !id.isEmpty { fail(id, error.localizedDescription, needsResolve: false) }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async { [weak self] in
      self?.backgroundCompletion?()
      self?.backgroundCompletion = nil
    }
  }

  // MARK: Completion

  private func fail(_ id: String, _ reason: String, needsResolve: Bool) {
    lock.lock()
    failed[id] = (reason, needsResolve)
    lock.unlock()
    session.getAllTasks { tasks in for t in tasks where (t.taskDescription ?? "").hasPrefix(id + "|") { t.cancel() } }
    onFailed?(id, reason, needsResolve)
  }

  private func finish(_ id: String) {
    lock.lock()
    guard var m = manifests[id] ?? Self.loadById(id), !m.finished else { lock.unlock(); return }
    lock.unlock()
    do {
      let part = URL(fileURLWithPath: m.partPath)
      let h = try FileHandle(forUpdating: part)
      defer { try? h.close() }
      try h.seek(toOffset: 0)
      var head = try h.read(upToCount: Int(min(m.total, 256 * 1024))) ?? Data()
      Mp4Patch.zeroMediaDuration(&head)
      try h.seek(toOffset: 0)
      try h.write(contentsOf: head)
      try h.synchronize()
      let dest = URL(fileURLWithPath: m.destPath)
      try? FileManager.default.removeItem(at: dest)
      try FileManager.default.moveItem(at: part, to: dest)
      m.finished = true
      lock.lock()
      manifests[id] = m
      lock.unlock()
      try? FileManager.default.removeItem(at: Self.manifestURL(m.partPath))
      onDone?(id, m.total)
    } catch {
      fail(id, "finalize failed: \(error.localizedDescription)", needsResolve: false)
    }
  }

  // MARK: Manifest persistence

  private static func save(_ m: Manifest) {
    if let data = try? JSONEncoder().encode(m) { try? data.write(to: manifestURL(m.partPath), options: .atomic) }
  }
  private static func load(_ partPath: String) -> Manifest? {
    guard let d = try? Data(contentsOf: manifestURL(partPath)) else { return nil }
    return try? JSONDecoder().decode(Manifest.self, from: d)
  }
  /// After a relaunch the in-memory table is empty: find the manifest by scanning the downloads directory.
  private static func loadById(_ id: String) -> Manifest? {
    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("downloads")
    return load(dir.appendingPathComponent("\(id).m4a.part").path)
  }
}
