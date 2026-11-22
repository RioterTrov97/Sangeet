import UIKit
import WebKit

/// Headless host for the YouTube extractor page (youtubei.js + BotGuard). A native WKWebView instead of a React
/// component, so it exists on a CarPlay-only launch where no React screen is ever mounted.
/// It never needs a window: WKWebView runs JS and network while detached. If a key window exists we parent it
/// (1x1, invisible) so WebKit treats it as visible and does not throttle its timers.
final class ExtractorWebView: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  static let shared = ExtractorWebView()

  var onMessage: ((String) -> Void)?
  var onReset: ((String) -> Void)?

  private var webView: WKWebView?
  private var html = ""
  private var baseURL: URL?

  /// The page talks to React Native through `window.ReactNativeWebView.postMessage`; map that onto WebKit.
  private static let shim = """
    window.ReactNativeWebView = { postMessage: function (m) { window.webkit.messageHandlers.rn.postMessage(m); } };
    """

  func load(html: String, baseURL: String) {
    DispatchQueue.main.async {
      self.html = html
      self.baseURL = URL(string: baseURL)
      self.create()
    }
  }

  func evaluate(_ js: String) {
    DispatchQueue.main.async { self.webView?.evaluateJavaScript(js, completionHandler: nil) }
  }

  private func create() {
    webView?.stopLoading()
    webView?.removeFromSuperview()
    let config = WKWebViewConfiguration()
    let controller = WKUserContentController()
    controller.addUserScript(WKUserScript(source: Self.shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    controller.add(WeakHandler(self), name: "rn")
    config.userContentController = controller
    let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
    view.navigationDelegate = self
    view.isUserInteractionEnabled = false
    view.alpha = 0.01
    webView = view
    if let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first {
      window.addSubview(view)
    }
    view.loadHTMLString(html, baseURL: baseURL)
  }

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    if let s = message.body as? String { onMessage?(s) }
  }

  func webView(_ w: WKWebView, didStartProvisionalNavigation n: WKNavigation!) { onReset?("Extractor reloading") }

  /// iOS kills WebKit content processes under memory pressure (common while backgrounded); rebuild and re-announce.
  func webViewWebContentProcessDidTerminate(_ w: WKWebView) {
    onReset?("Extractor web process terminated")
    create()
  }

  private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
  }
}
