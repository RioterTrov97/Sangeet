import { create } from 'zustand';

import { native } from '../../modules/app-updater';
import { playerState, usePlayerStore } from '../player/store';
import { getJson, setJson } from '../util/storage';
import { currentVersion, updateFeedUrl } from './config';
import { fetchUpdate, type UpdateRelease } from './releases';
import { compareVersions } from './version';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';

export type UpdateState = {
  status: UpdateStatus;
  /** 0..1 while downloading. */
  progress: number;
  release: UpdateRelease | null;
  /** Epoch ms of the last completed check (persisted). */
  lastChecked: number;
  /** Download and install updates by themselves (default on). */
  autoUpdate: boolean;
  /** Whether Android lets Sangeet install packages ("Install unknown apps"). */
  canInstall: boolean;
  error?: string;
  /** Path of the downloaded APK. */
  file?: string;
};

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const AUTO_KEY = 'update.auto';
export const CHECKED_KEY = 'update.lastChecked';
export const RELEASE_KEY = 'update.release';

const loadRelease = (): UpdateRelease | null => {
  const r = getJson<UpdateRelease>(RELEASE_KEY);
  return r && typeof r.version === 'string' && typeof r.apkUrl === 'string' && (compareVersions(r.version, currentVersion()) ?? 0) > 0 ? r : null;
};

/** The updater only exists on Android builds that were given a repo (or a dev feed). */
export const updaterAvailable = (): boolean => !!native && !!updateFeedUrl();

const readCanInstall = (): boolean => {
  try {
    return native?.canInstall() ?? false;
  } catch {
    return false;
  }
};

export const useUpdate = create<UpdateState>(() => {
  const release = loadRelease();
  return {
    status: release ? 'available' : 'idle',
    progress: 0,
    release,
    lastChecked: getJson<number>(CHECKED_KEY) ?? 0,
    autoUpdate: getJson<boolean>(AUTO_KEY) !== false,
    canInstall: readCanInstall(),
  };
});

const set = (p: Partial<UpdateState>): void => useUpdate.setState(p);
const get = (): UpdateState => useUpdate.getState();

export function setAutoUpdate(on: boolean): void {
  set({ autoUpdate: on });
  setJson(AUTO_KEY, on);
  if (on) {
    const s = get();
    if (s.status === 'available') void startDownload();
    else maybeAutoInstall();
  }
}

export const refreshCanInstall = (): void => set({ canInstall: readCanInstall() });

const isPlaying = (): boolean => ['playing', 'buffering'].includes(playerState().status);

/** Pure policy: install by itself only with auto-update on, a finished download, and nothing playing. */
export function shouldAutoInstall(s: Pick<UpdateState, 'autoUpdate' | 'status' | 'canInstall'>, playing: boolean): boolean {
  return s.autoUpdate && s.status === 'ready' && s.canInstall && !playing;
}

let checking: Promise<void> | undefined;

/** Looks for a newer release: at most once per 6 h unless `force`. Errors are quiet (status `error` only for a forced check). */
export function checkForUpdate({ force = false }: { force?: boolean } = {}): Promise<void> {
  const url = updateFeedUrl();
  if (!native || !url) return Promise.resolve();
  const busy = ['downloading', 'installing', 'checking'].includes(get().status);
  if (busy) return checking ?? Promise.resolve();
  if (!force && Date.now() - get().lastChecked < CHECK_EVERY_MS) return Promise.resolve();
  const prev = get().status;
  set({ status: 'checking', error: undefined });
  checking = (async () => {
    try {
      const release = await fetchUpdate(url, currentVersion());
      const lastChecked = Date.now();
      setJson(CHECKED_KEY, lastChecked);
      if (!release) {
        setJson(RELEASE_KEY, null);
        set({ status: 'idle', release: null, lastChecked, file: undefined });
        return;
      }
      setJson(RELEASE_KEY, release);
      const same = get().release?.version === release.version && !!get().file;
      set({ release, lastChecked, status: same ? 'ready' : 'available' });
      if (same) maybeAutoInstall();
      else if (get().autoUpdate) void startDownload();
    } catch (e) {
      set(force ? { status: 'error', error: e instanceof Error ? e.message : String(e) } : { status: prev === 'checking' ? 'idle' : prev });
    } finally {
      checking = undefined;
    }
  })();
  return checking;
}

/** Downloads the found release. Runs on its own once found when auto-update is on; otherwise `updateNow` starts it. */
export async function startDownload(): Promise<void> {
  const { release, status } = get();
  if (!native || !release || (status !== 'available' && status !== 'error')) return;
  set({ status: 'downloading', progress: 0, error: undefined });
  const sub = native.addListener('onProgress', (e) => set({ progress: e.progress }));
  try {
    const file = await native.download(release.apkUrl, release.sha256 ?? null, release.fileName || `sangeet-android-v${release.version}.apk`);
    set({ status: 'ready', progress: 1, file });
    maybeAutoInstall();
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  } finally {
    sub.remove();
  }
}

/** The Update button: downloads first when auto-update has not, then installs. */
export async function updateNow(): Promise<void> {
  if (get().status === 'available' || (get().status === 'error' && !get().file)) await startDownload();
  await installNow();
}

/** Installs the downloaded APK (the user pressed Update). Sends the user to the "Install unknown apps" screen when not allowed. */
export async function installNow(): Promise<void> {
  const { file, status } = get();
  if (!native || !file || status !== 'ready') return;
  refreshCanInstall();
  if (!get().canInstall) return openInstallSettings();
  set({ status: 'installing', error: undefined });
  try {
    const r = await native.install(file);
    // Success normally kills this process first; reaching here means the install did not replace the app.
    set(r.status === 0 ? { status: 'ready' } : { status: 'error', error: r.message || `Install failed (${r.status})` });
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

export function openInstallSettings(): void {
  try {
    native?.openInstallSettings();
  } catch {}
}

/** Auto-install when allowed by the policy. Never interrupts playback: called at launch and whenever playback stops. */
export function maybeAutoInstall(): void {
  if (shouldAutoInstall(get(), isPlaying())) void installNow();
}

let started = false;
let timer: ReturnType<typeof setInterval> | undefined;

/** Call once the home screen is up: checks now (throttled), every 6 h while running, and installs when playback stops. */
export function startUpdater(): () => void {
  if (started || !updaterAvailable()) return () => {};
  started = true;
  const s = get();
  if (s.status === 'available' && s.autoUpdate) void startDownload();
  void checkForUpdate();
  timer = setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
  const unsub = usePlayerStore.subscribe((cur, prev) => {
    const was = ['playing', 'buffering'].includes(prev.status);
    const now = ['playing', 'buffering'].includes(cur.status);
    if (was && !now) maybeAutoInstall();
  });
  return () => {
    started = false;
    clearInterval(timer);
    unsub();
  };
}
