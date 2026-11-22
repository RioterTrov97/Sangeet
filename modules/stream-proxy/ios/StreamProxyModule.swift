import ExpoModulesCore
import Foundation

public class StreamProxyModule: Module {
  private let server = ProxyServer.shared

  public func definition() -> ModuleDefinition {
    Name("StreamProxy")
    Events("onSongCached", "onResolveRequest", "onExtractorMessage", "onExtractorReset", "onDownloadProgress", "onDownloadDone", "onDownloadFailed")

    OnCreate {
      self.server.onResolveRequest = { [weak self] videoId, requestId, refresh in
        self?.sendEvent("onResolveRequest", ["videoId": videoId, "requestId": requestId, "refresh": refresh])
      }
      self.server.onCached = { [weak self] id in self?.sendEvent("onSongCached", ["id": id]) }
      let dl = BackgroundDownloader.shared
      dl.onProgress = { [weak self] id, bytes, total in self?.sendEvent("onDownloadProgress", ["id": id, "bytes": bytes, "total": total]) }
      dl.onDone = { [weak self] id, bytes in self?.sendEvent("onDownloadDone", ["id": id, "bytes": bytes]) }
      dl.onFailed = { [weak self] id, reason, needsResolve in self?.sendEvent("onDownloadFailed", ["id": id, "reason": reason, "needsResolve": needsResolve]) }
      dl.attach()
      ExtractorWebView.shared.onMessage = { [weak self] data in self?.sendEvent("onExtractorMessage", ["data": data]) }
      ExtractorWebView.shared.onReset = { [weak self] reason in self?.sendEvent("onExtractorReset", ["reason": reason]) }
    }

    /// Loads (or reloads) the extractor page in the headless WKWebView.
    Function("extractorLoad") { (html: String, baseUrl: String) in
      ExtractorWebView.shared.load(html: html, baseURL: baseUrl)
    }

    Function("extractorEval") { (js: String) in
      ExtractorWebView.shared.evaluate(js)
    }

    AsyncFunction("start") { () async throws -> Int in
      return Int(try await self.server.start())
    }

    AsyncFunction("restart") { () async throws -> Int in
      return Int(try await self.server.restart())
    }

    /// JS answers a resolve request (or primes the cache ahead of time with requestId = null).
    Function("fulfill") { (requestId: String?, videoId: String, info: [String: Any]) in
      guard let urlString = info["url"] as? String, let url = URL(string: urlString) else { return }
      let num = { (k: String) -> Int64 in (info[k] as? NSNumber)?.int64Value ?? -1 }
      let stream = ProxyStream(
        url: url,
        length: num("contentLength"),
        mime: info["mimeType"] as? String ?? "audio/mp4",
        userAgent: info["userAgent"] as? String ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        headers: info["headers"] as? [String: String] ?? [:],
        expiresAt: Double(num("expiresAt")) / 1000,
        initStart: num("initStart"), initEnd: num("initEnd"),
        indexStart: num("indexStart"), indexEnd: num("indexEnd"),
        codecs: info["codecs"] as? String ?? "",
        width: max(0, num("width")), height: max(0, num("height")), bitrate: max(0, num("bitrate")))
      if let rid = requestId { self.server.fulfill(requestId: rid, stream: stream) }
      else { self.server.prime(id: videoId, stream: stream) }
    }

    Function("reject") { (requestId: String, reason: String) in
      self.server.reject(requestId: requestId, reason: reason)
    }

    /// Background URLSession download in 4 MB ranges (see BackgroundDownloader).
    Function("bgDownloadStart") { (id: String, spec: [String: Any]) in
      guard let url = spec["url"] as? String, let part = spec["partPath"] as? String, let dest = spec["destPath"] as? String else { return }
      BackgroundDownloader.shared.start(
        id: id, url: url, headers: spec["headers"] as? [String: String] ?? [:],
        userAgent: spec["userAgent"] as? String ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        total: (spec["total"] as? NSNumber)?.int64Value ?? 0, partPath: part, destPath: dest)
    }

    Function("bgDownloadCancel") { (id: String) in BackgroundDownloader.shared.cancel(id: id) }

    Function("bgDownloadStatus") { () -> [[String: Any]] in BackgroundDownloader.shared.status() }

    /// Budget for background song downloads in bytes (0 = off). Finished songs are ranked and trimmed by JS.
    Function("cacheConfigure") { (bytes: Double) in self.server.cache.capBytes = Int64(bytes) }

    /// Every finished song: [{id, bytes, lastUsed}] (lastUsed in epoch ms).
    Function("cacheList") { () -> [[String: Any]] in
      self.server.cache.list().map { ["id": $0.0, "bytes": $0.1, "lastUsed": $0.2.timeIntervalSince1970 * 1000] }
    }
    Function("cacheDelete") { (id: String) in self.server.cache.delete(id) }
    Function("cacheClear") { () in self.server.cache.clear() }

    /// The fully downloaded copy of a song in the background cache, if any ({path, bytes}); Offline downloads reuse it.
    Function("cacheLookup") { (id: String) -> [String: Any]? in
      guard let f = self.server.cache.complete(id) else { return nil }
      let n = ((try? FileManager.default.attributesOfItem(atPath: f.path))?[.size] as? NSNumber)?.int64Value ?? 0
      return ["path": f.path, "bytes": n]
    }

    /// Dev "force offline" switch: the proxy treats every upstream request as failed with notConnectedToInternet.
    Function("setSimulateOffline") { (on: Bool) in self.server.simulateOffline = on }

    /// Tags + artwork of a local audio file (see AudioTags). artworkOut: where to write the cover bytes (a path, not a file:// uri).
    AsyncFunction("readAudioTags") { (path: String, artworkOut: String) async -> [String: Any] in
      return await AudioTags.read(path: path, artworkOut: artworkOut)
    }

    Function("unregister") { (id: String) in
      self.server.unregister(id: id)
    }
  }
}
