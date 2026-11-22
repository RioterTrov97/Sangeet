import type { ExpoConfig } from 'expo/config';

// A free Personal Team can sign neither the CarPlay nor the Siri entitlement. One switch turns both off:
//   SANGEET_FREE_TEAM=1 npx expo run:ios --device
// (or individually: SANGEET_CARPLAY=0, SANGEET_SIRI=0; the Siri entitlement itself is added by modules/siri-media/plugin).
const freeTeam = process.env.SANGEET_FREE_TEAM === '1';
const carPlayEntitlement = !freeTeam && process.env.SANGEET_CARPLAY !== '0';

// Splash is a static launch storyboard on iOS (it cannot change at runtime), so its look is a build-time option:
//   SANGEET_SPLASH=light|dark (default dark: white glyph on black).
const splashLight = process.env.SANGEET_SPLASH === 'light';

// EAS Update (https://u.expo.dev/<project-id>) or a self-hosted static manifest server.
const updatesUrl = process.env.SANGEET_UPDATES_URL;

// Screenshot builds (scripts/screenshots.sh): a Release build for the simulator with the dev deep-link driver switched on,
// so `sangeet://dev?cmd=...` can start a song before each capture. Never set for TestFlight (app.config.test.ts guards the default).
const screenshots = process.env.SANGEET_SCREENSHOTS === '1';

// Bundle ID (iOS) and applicationId (Android) come from git-ignored .env.local (see .env.local.example).
const bundleId = process.env.SANGEET_BUNDLE_ID || 'com.example.sangeet';

const config: ExpoConfig = {
  name: 'Sangeet',
  slug: 'sangeet',
  scheme: 'sangeet',
  version: '0.1.0',
  // Portrait everywhere (each screen locks it, app/_layout); full-screen video turns to landscape, so the app must allow it.
  orientation: 'default',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: bundleId,
    // Signing team for local device builds (scripts/device-build.sh reads it from the gitignored .env.device).
    ...(process.env.SANGEET_APPLE_TEAM ? { appleTeamId: process.env.SANGEET_APPLE_TEAM } : {}),
    supportsTablet: false,
    icon: './assets/images/icon.png',
    infoPlist: {
      UIBackgroundModes: ['audio'],
      // Documents shows in the Files app (On My iPhone > Sangeet) and in Finder over USB: Documents/Music is where songs from this iPhone live.
      UIFileSharingEnabled: true,
      LSSupportsOpeningDocumentsInPlace: true,
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      // Phone-as-remote: find and talk to Sangeet on a Google TV over the LAN (Bonjour + TCP).
      NSLocalNetworkUsageDescription: 'Sangeet connects to your Google TV on the local network so the phone can control playback.',
      NSBonjourServices: ['_sangeet._tcp'],
      // Required by App Store processing (ITMS-90683): expo-image and expo-file-system link PhotoKit even though
      // Sangeet never opens the photo library. Without it, uploads are rejected.
      // Export compliance: only standard HTTPS/TLS (exempt), so TestFlight builds skip the "Missing Compliance" question.
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription: 'Sangeet does not use your photo library. This permission is never requested.',
      // CarPlay scene, as described in the react-native-nitro-player CarPlay guide.
      // The phone scene (Expo SDK 58 template default) must be restated: infoPlist replaces the whole key.
      UIApplicationSceneManifest: {
        UIApplicationSupportsMultipleScenes: true,
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [
            {
              UISceneConfigurationName: 'Default Configuration',
              UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
            },
          ],
          CPTemplateApplicationSceneSessionRoleApplication: [
            {
              UISceneClassName: 'CPTemplateApplicationScene',
              UISceneConfigurationName: 'CarPlay',
              UISceneDelegateClassName: 'NitroPlayerCarPlaySceneDelegate',
            },
          ],
        },
      },
    },
    entitlements: carPlayEntitlement ? { 'com.apple.developer.carplay-audio': true } : {},
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#000000',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    package: bundleId,
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    // First in the list = its manifest mod runs last (mods unwind in reverse), so it can post-process what the plugins below write.
    './plugins/withAndroidTV',
    'expo-router',
    './modules/siri-media/plugin',
    ['expo-build-properties', { ios: { deploymentTarget: '17.0' } }],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Sangeet listens to your voice only while you use voice search.',
        speechRecognitionPermission: 'Sangeet turns your voice into a search query on this device.',
        androidSpeechServicePackages: [],
      },
    ],
    [
      'expo-splash-screen',
      { backgroundColor: splashLight ? '#ffffff' : '#000000', image: splashLight ? './assets/images/splash-icon-light.png' : './assets/images/splash-icon.png', imageWidth: 120 },
    ],
    // Alternate app icons (Settings > Appearance > App Icon). The default icon is ./assets/images/icon.png (White on Black).
    [
      'expo-alternate-app-icons',
      [
        { name: 'BlackOnWhite', ios: './assets/icons/BlackOnWhite.png' },
        { name: 'GreenOnBlack', ios: './assets/icons/GreenOnBlack.png' },
        { name: 'Classic', ios: './assets/icons/Classic.png' },
      ],
    ],
  ],
  // OTA JS updates (YouTube-breakage fixes without a rebuild). Off until SANGEET_UPDATES_URL is set: see docs/INSTALL.md.
  runtimeVersion: { policy: 'appVersion' },
  updates: updatesUrl ? { url: updatesUrl, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 } : { enabled: false },
  extra: { screenshots },
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
