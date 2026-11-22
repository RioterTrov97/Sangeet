import ExpoModulesCore
import UIKit

/// iOS relaunches the app in the background when a background URLSession has events; hand it the completion handler
/// and re-attach to the session so the delegate receives the finished chunks.
public class BackgroundDownloadAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
    guard identifier == BackgroundDownloader.sessionId else { return completionHandler() }
    BackgroundDownloader.shared.backgroundCompletion = completionHandler
    BackgroundDownloader.shared.attach()
  }
}
