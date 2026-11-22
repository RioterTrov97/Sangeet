const { withInfoPlist, withEntitlementsPlist, withAppDelegate } = require('@expo/config-plugins');

const MARK = '// sangeet-siri-media';
const SNIPPET = `
${MARK}
import Intents
internal import SiriMedia

extension AppDelegate {
  /// INPlayMediaIntent handled in-app. Expo's app-delegate subscribers do not forward INIntent selectors, so the
  /// selector is implemented on the app delegate itself and handed to the SiriMedia module's queue.
  @objc(application:handleIntent:completionHandler:)
  public func application(_ application: UIApplication, handle intent: INIntent, completionHandler: @escaping (INIntentResponse) -> Void) {
    SiriIntentBridge.shared.handle(intent, completion: completionHandler)
  }
}
`;

/**
 * Siri media intents (in-app handling):
 *  - Info.plist: NSSiriUsageDescription, INIntentsSupported = [INPlayMediaIntent]
 *  - entitlement com.apple.developer.siri (skipped with SANGEET_SIRI=0 or SANGEET_FREE_TEAM=1: a free Personal Team cannot sign it)
 *  - AppDelegate: application(_:handle:completionHandler:)
 */
module.exports = function withSiriMedia(config) {
  const entitlement = process.env.SANGEET_SIRI !== '0' && process.env.SANGEET_FREE_TEAM !== '1';
  config = withInfoPlist(config, (c) => {
    c.modResults.NSSiriUsageDescription = 'Sangeet uses Siri so you can ask it to play songs, artists and playlists.';
    c.modResults.INIntentsSupported = ['INPlayMediaIntent'];
    // Read by SiriMediaModule: Intents APIs (INVocabulary) throw an uncatchable ObjC exception without the entitlement.
    c.modResults.SangeetSiriEntitled = entitlement;
    return c;
  });
  if (entitlement) {
    config = withEntitlementsPlist(config, (c) => {
      c.modResults['com.apple.developer.siri'] = true;
      return c;
    });
  }
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language === 'swift' && !c.modResults.contents.includes(MARK)) c.modResults.contents += SNIPPET;
    return c;
  });
  return config;
};
