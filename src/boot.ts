/**
 * App boot, imported first by the custom entry (index.ts). Everything here is plain modules, no React, so it runs
 * when iOS launches the app only for CarPlay (React Native starts without a window; no screen or hook ever mounts).
 */
import { initAuth } from './auth/store';
import { initLibrary } from './library/store';
import { disableAutoCache, savedArtworkUrl, startAutoCache } from './downloads/autoCache';
import { setSavedArtwork } from './ui/palette/extract';
import { clearDownloadsIfAny, startDownloads } from './downloads/manager';
import { startNet } from './downloads/net';
import { setupAndroidAuto } from './androidauto';
import { setupCarPlay } from './carplay';
import { setLyricsSidecar } from './lyrics';
import { startLyricsPrefetch } from './lyrics/prefetch';
import { localLrcText, startLocalSongs } from './local';
import { startSiri } from './siri';
import { startPaletteSync } from './ui/palette/store';
import { startVideoController } from './video/controller';
import { startNowPlayingButtons } from './player/nowPlayingButtons';
import { startPlayerBridge } from './player/bridge';
import { startNotificationPermission } from './player/notifyPermission';
import { ensurePlayerReady, restoreAtLaunch, restoreQueue, startPersisting } from './player/queue';
import { Platform } from 'react-native';
import { startDiscovery } from './remote/phone';
import { log, logWarn } from './util/log';
import { perfStart } from './util/perf';
import { resolver } from './player/proxy';
import { loadServerConfig } from './youtube/resolver/serverConfig';
import { startHealthChecks } from './youtube/resolver/healthCheck';
import { restoreQueryCache } from './youtube/queryClient';

perfStart('launch');
log('boot', 'start');
initLibrary();
startNet();
void restoreQueryCache();
startPlayerBridge();
startPersisting();
startNowPlayingButtons();
startNotificationPermission();
startLyricsPrefetch();
startPaletteSync();
startSiri();
startVideoController();
// The TV streams only: no manual downloads and no automatic offline storage (anything saved by older builds is removed).
if (Platform.isTV) {
  disableAutoCache();
  clearDownloadsIfAny();
} else {
  startDownloads();
  startAutoCache();
  setSavedArtwork(savedArtworkUrl);
  // Songs from this iPhone: creates Documents/Music (shows in Files) and scans it now and whenever the app becomes active.
  setLyricsSidecar(localLrcText);
  startLocalSongs();
}
void initAuth();
void loadServerConfig();
startHealthChecks(resolver);
setupCarPlay();
setupAndroidAuto();
// Phone: watch for Sangeet TVs on the network (the TV button only appears once one is found).
if (Platform.OS === 'ios' || (Platform.OS === 'android' && !Platform.isTV)) startDiscovery();
ensurePlayerReady()
  .then(() => (Platform.isTV ? restoreQueue() : restoreAtLaunch()))
  .then((restored) => log('boot', `player ready, queue restored=${restored}`))
  .catch((e) => logWarn('boot', 'player setup failed', e));

// TV links. YouTube Music links (`sangeet://open?url=<music.youtube.com link>`, sent by the TV launcher) play the song,
// album or playlist. Real-device profiling (release too): `sangeet://perf?on=1` switches perf mode, which then allows
// `sangeet://dev?cmd=nav|type|mark|stalls`.
if (Platform.isTV) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Linking } = require('react-native') as typeof import('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isMusicLink } = require('./tv/musicLink') as typeof import('./tv/musicLink');
  const run = (url?: string | null) => {
    if (!url) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (isMusicLink(url)) (require('./tv/openMusicLink') as typeof import('./tv/openMusicLink')).openMusicLink(url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    else (require('./dev/perfDriver') as typeof import('./dev/perfDriver')).runPerfLink(url);
  };
  void Linking.getInitialURL().then(run).catch(() => {});
  Linking.addEventListener('url', (e) => void run(e.url));
}

// Dev only: `adb shell am start -a android.intent.action.VIEW -d 'sangeet://dev?cmd=...'` also drives the TV app (no router there).
if (__DEV__) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- keeps the dev driver out of release bundles
  const { Linking } = require('react-native') as typeof import('react-native');
  const run = (url: string | null) => {
    const m = url && /^sangeet:\/\/dev\?(.*)$/.exec(url);
    if (!m) return;
    const q = new URLSearchParams(m[1]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./dev/driver') as typeof import('./dev/driver')).runDevCommand(q.get('cmd') ?? '', q.get('a') ?? undefined, q.get('b') ?? undefined);
  };
  Linking.addEventListener('url', (e) => run(e.url));
}
