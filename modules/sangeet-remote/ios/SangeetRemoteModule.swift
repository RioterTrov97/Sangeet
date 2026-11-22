import ExpoModulesCore
import Foundation
import Network

/// Phone side of the Sangeet TV remote: Bonjour discovery of `_sangeet._tcp` and newline-framed TCP client
/// connections (NWConnection). Message framing and the protocol live in JS (src/remote).
public class SangeetRemoteModule: Module {
  private let queue = DispatchQueue(label: "sangeet.remote")
  private var browser: NWBrowser?
  private var found: [String: NWBrowser.Result] = [:]
  private var conns: [String: NWConnection] = [:]
  private var seq = 0

  public func definition() -> ModuleDefinition {
    Name("SangeetRemote")
    Events("onService", "onOpen", "onData", "onClose")

    Function("startBrowse") { self.startBrowse() }
    Function("stopBrowse") { self.queue.async { self.browser?.cancel(); self.browser = nil; self.found = [:] } }

    /// `target` is "svc:<service name>" (a discovered TV) or "host:port".
    Function("connect") { (target: String) -> String in self.connect(target) }
    Function("send") { (id: String, data: String) in self.queue.async { self.conns[id]?.send(content: data.data(using: .utf8), completion: .contentProcessed { _ in }) } }
    /// Graceful close: queued sends (e.g. a final `pause`) are flushed before the FIN; cancel() alone would drop them.
    Function("close") { (id: String) in
      self.queue.async {
        guard let c = self.conns[id] else { return }
        c.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
        self.queue.asyncAfter(deadline: .now() + 1.0) { c.cancel() }
      }
    }
    Function("randomHex") { (bytes: Int) -> String in
      var b = [UInt8](repeating: 0, count: max(1, bytes))
      _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
      return b.map { String(format: "%02x", $0) }.joined()
    }
  }

  private func startBrowse() {
    queue.async {
      self.browser?.cancel()
      let b = NWBrowser(for: .bonjourWithTXTRecord(type: "_sangeet._tcp", domain: nil), using: .tcp)
      b.browseResultsChangedHandler = { [weak self] _, changes in
        guard let self else { return }
        for ch in changes {
          switch ch {
          case .added(let r), .changed(_, let r, _):
            guard case let .service(name, _, _, _) = r.endpoint else { continue }
            self.found[name] = r
            var txt: [String: String] = [:]
            if case let .bonjour(rec) = r.metadata { txt = rec.dictionary }
            self.sendEvent("onService", ["key": name, "name": txt["name"] ?? name, "tvId": txt["id"] ?? name, "found": true])
          case .removed(let r):
            guard case let .service(name, _, _, _) = r.endpoint else { continue }
            self.found[name] = nil
            self.sendEvent("onService", ["key": name, "name": name, "tvId": name, "found": false])
          default: break
          }
        }
      }
      b.start(queue: self.queue)
      self.browser = b
    }
  }

  private func connect(_ target: String) -> String {
    seq += 1
    let id = "c\(seq)"
    queue.async {
      let conn: NWConnection
      if target.hasPrefix("svc:"), let r = self.found[String(target.dropFirst(4))] {
        conn = NWConnection(to: r.endpoint, using: .tcp)
      } else {
        let parts = target.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, let port = NWEndpoint.Port(String(parts[1])) else {
          self.sendEvent("onClose", ["conn": id, "error": "Bad address"])
          return
        }
        conn = NWConnection(host: NWEndpoint.Host(String(parts[0])), port: port, using: .tcp)
      }
      self.conns[id] = conn
      var buffer = Data()
      var closed = false
      let finish: (String?) -> Void = { err in
        if closed { return }
        closed = true
        self.conns[id] = nil
        conn.cancel()
        var p: [String: Any] = ["conn": id]
        if let err { p["error"] = err }
        self.sendEvent("onClose", p)
      }
      conn.stateUpdateHandler = { state in
        switch state {
        case .ready:
          self.sendEvent("onOpen", ["conn": id])
          func loop() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, complete, error in
              if let data, !data.isEmpty {
                buffer.append(data)
                while let nl = buffer.firstIndex(of: 0x0A) {
                  let line = buffer.subdata(in: buffer.startIndex..<nl)
                  buffer.removeSubrange(buffer.startIndex...nl)
                  if let s = String(data: line, encoding: .utf8) { self.sendEvent("onData", ["conn": id, "data": s + "\n"]) }
                }
              }
              if let error { return finish(error.localizedDescription) }
              if complete { return finish(nil) }
              loop()
            }
          }
          loop()
        case .failed(let e): finish(e.localizedDescription)
        case .waiting(let e): finish(e.localizedDescription) // unreachable host / local network denied: let JS decide to retry
        case .cancelled: finish(nil)
        default: break
        }
      }
      conn.start(queue: self.queue)
    }
    return id
  }
}
