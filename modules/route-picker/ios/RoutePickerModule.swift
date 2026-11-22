import AVKit
import ExpoModulesCore

class RoutePickerView: ExpoView {
  let picker = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    picker.activeTintColor = UIColor(red: 0.118, green: 0.843, blue: 0.376, alpha: 1)
    picker.tintColor = .white
    picker.prioritizesVideoDevices = false
    addSubview(picker)
  }

  private func color(_ hex: String) -> UIColor? {
    let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    return UIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
  }

  func setTint(_ hex: String) {
    if let c = color(hex) { picker.tintColor = c }
  }

  /// Colour of the icon while an AirPlay route is active (the palette accent).
  func setActiveTint(_ hex: String) {
    if let c = color(hex) { picker.activeTintColor = c }
  }

  override func layoutSubviews() {
    picker.frame = bounds
  }
}

public class RoutePickerModule: Module {
  private let detector = AVRouteDetector()
  private var observers: [NSObjectProtocol] = []

  private func active() -> Bool {
    AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .airPlay }
  }

  /// Opens the system AirPlay sheet without a visible button: an off-screen AVRoutePickerView gets its button tapped.
  private func presentPicker() {
    guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return }
    let picker = AVRoutePickerView(frame: CGRect(x: -80, y: -80, width: 44, height: 44))
    picker.isHidden = false
    window.addSubview(picker)
    picker.subviews.compactMap { $0 as? UIButton }.first?.sendActions(for: .touchUpInside)
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { picker.removeFromSuperview() }
  }

  /// AirPlay is worth showing when other routes are reachable, or an AirPlay route is already active.
  private func available() -> Bool {
    if detector.multipleRoutesDetected { return true }
    return AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .airPlay }
  }

  public func definition() -> ModuleDefinition {
    Name("RoutePicker")
    Events("onChange")

    OnCreate {
      self.detector.isRouteDetectionEnabled = true
      let nc = NotificationCenter.default
      let emit: (Notification) -> Void = { [weak self] _ in
        guard let self else { return }
        self.sendEvent("onChange", ["available": self.available(), "active": self.active()])
      }
      self.observers = [
        nc.addObserver(forName: .AVRouteDetectorMultipleRoutesDetectedDidChange, object: self.detector, queue: .main, using: emit),
        nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main, using: emit),
      ]
    }
    OnDestroy {
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      self.detector.isRouteDetectionEnabled = false
    }
    Function("isAvailable") { () -> Bool in self.available() }
    /// Name of the current audio output ("iPhone", "AirPods Pro", an AirPlay speaker, ...) and whether it is AirPlay.
    Function("routeName") { () -> String in AVAudioSession.sharedInstance().currentRoute.outputs.first?.portName ?? "" }
    Function("isActive") { () -> Bool in self.active() }
    Function("showPicker") { () in DispatchQueue.main.async { self.presentPicker() } }

    View(RoutePickerView.self) {
      Prop("tint") { (view: RoutePickerView, hex: String) in view.setTint(hex) }
      Prop("activeTint") { (view: RoutePickerView, hex: String) in view.setActiveTint(hex) }
      Prop("prioritizeVideo") { (view: RoutePickerView, on: Bool) in view.picker.prioritizesVideoDevices = on }
    }
  }
}
