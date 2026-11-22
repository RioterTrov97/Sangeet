import CookieManager from '@react-native-cookies/cookies';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { getDb } from '../db/client';
import * as repo from '../db/repo';
import { serialRunner } from '../library/serialRunner';
import { initLibrary, refreshLibrary, setFollowSync, setLikeSync } from '../library/store';
import { applyYtLibrary, noteFollowChange, noteLikeChange, resetSnapshot, resetTouched } from '../library/ytSync';
import { isLocalId } from '../local/id';
import { resetHistoryCache } from '../player/history';
import { log, logWarn } from '../util/log';
import { getJson, setJson, storage } from '../util/storage';
import { reportYtPlayback, setAuthCookie, setAuthErrorHandler, setYtLike, setYtSubscribe } from '../youtube/api';
import type { Artist, Track } from '../youtube/models';
import { queryClient } from '../youtube/queryClient';
import { repeatGuard } from './repeatGuard';
import { headerHasAuth, mergeCookies, MUSIC_ORIGIN, toCookieHeader, hasAuthCookie } from './cookies';

/**
 * Optional YouTube sign-in. The cookie header lives only in the keychain (expo-secure-store) and in youtubei.js's
 * in-memory session; it is never logged, never put in a URL, and never sent to the stream extractor (which stays
 * anonymous: age-restricted playback is the only case that might need it).
 */
export type AuthStatus = 'anon' | 'signedIn' | 'expired';

/** v2: cookies merged with YouTube's values winning. A v1 header carries Google's SID / SAPISID, which YouTube treats as logged out. */
const COOKIE_KEY = 'yt.cookie.v2';
const OLD_COOKIE_KEY = 'yt.cookie.v1';
const PREFS_KEY = 'auth.prefs.v1';
const ACCOUNT_KEY = 'auth.account.v1';
const ACCOUNT_REFRESH_MS = 24 * 3600_000;

/** Non-secret display data of the signed-in account (name, handle, photo URL), kept so the avatar shows at once at launch. */
export type Account = { name: string; handle?: string; photo?: string };
type SavedAccount = Account & { at?: number };

const initialAccount = (): Account | undefined => {
  const a = savedAccount();
  return a ? { name: a.name, handle: a.handle, photo: a.photo } : undefined;
};
const savedAccount = (): SavedAccount | undefined => getJson<SavedAccount>(ACCOUNT_KEY);

export const useAuth = create<{ status: AuthStatus; reportHistory: boolean; syncing: boolean; lastSyncAt?: number; account?: Account }>(() => ({
  status: 'anon',
  account: initialAccount(),
  // On unless turned off: YouTube's recommendations (Quick picks, mixes) only learn from plays it is told about.
  reportHistory: getJson<{ reportHistory?: boolean }>(PREFS_KEY)?.reportHistory ?? true,
  syncing: false,
}));

export const isSignedIn = () => useAuth.getState().status === 'signedIn';

export function setReportHistory(on: boolean): void {
  useAuth.setState({ reportHistory: on });
  setJson(PREFS_KEY, { reportHistory: on });
}

function activate(header: string): void {
  setAuthCookie(header);
  setAuthErrorHandler(markExpired);
  setLikeSync(async (track: Track, on: boolean) => {
    noteLikeChange(track.id); // a sync running right now must not undo this before YouTube has it
    if (isSignedIn() && !isLocalId(track.id)) await setYtLike(track.id, on); // a song from this iPhone is liked locally only
  });
  setFollowSync(async (artist: Artist, on: boolean) => {
    noteFollowChange(artist.id);
    if (isSignedIn()) await setYtSubscribe(artist, on);
  });
  useAuth.setState({ status: 'signedIn' });
}

/** Fetches the account's name and photo (not blocking, at most once per 24 h unless `force`). */
export async function refreshAccount(force = false): Promise<void> {
  try {
    const saved = savedAccount();
    if (!force && saved?.at && Date.now() - saved.at < ACCOUNT_REFRESH_MS) return;
    const { getAccountInfo } = await import('../youtube/api');
    const info = await getAccountInfo();
    if (!info || !isSignedIn()) return;
    setJson(ACCOUNT_KEY, { ...info, at: Date.now() });
    useAuth.setState({ account: info });
  } catch (e) {
    logWarn('auth', 'account info failed', e instanceof Error ? e.message : e);
  }
}

/** Restores a saved session at boot (keychain read is async). Never throws. */
export async function initAuth(): Promise<void> {
  try {
    const header = await SecureStore.getItemAsync(COOKIE_KEY);
    if (!header && (await SecureStore.getItemAsync(OLD_COOKIE_KEY))) {
      // Saved by an older version with the wrong cookie values: ask for a fresh sign-in (Home shows the banner).
      await SecureStore.deleteItemAsync(OLD_COOKIE_KEY).catch(() => {});
      useAuth.setState({ status: 'expired' });
      log('auth', 'old session format; asking to sign in again');
      return;
    }
    if (header && headerHasAuth(header)) {
      activate(header);
      log('auth', 'session restored');
      void refreshAccount();
      void syncYtLibrary();
    }
  } catch (e) {
    logWarn('auth', 'restore failed', e instanceof Error ? e.message : e);
  }
}

/** Reads the cookies the sign-in WebView collected (WebKit store). Returns the header when it holds an auth cookie. */
export async function captureCookies(): Promise<string | undefined> {
  // Later maps win in mergeCookies. Google's own SID / SAPISID / __Secure-*PSID differ from YouTube's, and YouTube treats
  // a request carrying Google's values as logged out, so the YouTube cookies must come last.
  const maps = await Promise.all([CookieManager.get('https://accounts.google.com', true), CookieManager.get('https://www.youtube.com', true), CookieManager.get(MUSIC_ORIGIN, true)]);
  const merged = mergeCookies(...maps.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { value: v.value, domain: v.domain }]))));
  return hasAuthCookie(merged) ? toCookieHeader(merged) : undefined;
}

export async function completeSignIn(header: string): Promise<void> {
  await SecureStore.setItemAsync(COOKIE_KEY, header, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  activate(header);
  queryClient.removeQueries({ queryKey: ['yt'] }); // anonymous Home etc. must not be shown as personalised
  log('auth', 'signed in');
  void refreshAccount(true); // maybe a different person than the saved one
  void syncYtLibrary();
}

/** 401/403 from an authed call: keep working anonymously and ask the user to sign in again. */
export function markExpired(): void {
  if (useAuth.getState().status !== 'signedIn') return;
  logWarn('auth', 'session expired; falling back to anonymous');
  setAuthCookie(undefined);
  useAuth.setState({ status: 'expired' });
  queryClient.removeQueries({ queryKey: ['yt'] });
}

export async function signOut(): Promise<void> {
  setAuthCookie(undefined);
  setLikeSync(undefined);
  setFollowSync(undefined);
  useAuth.setState({ status: 'anon', syncing: false, account: undefined });
  storage.remove(ACCOUNT_KEY);
  await SecureStore.deleteItemAsync(COOKIE_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(OLD_COOKIE_KEY).catch(() => {});
  await CookieManager.clearAll(true).catch(() => {});
  initLibrary();
  repo.clearYtRows(getDb());
  resetSnapshot();
  refreshLibrary();
  resetHistoryCache();
  queryClient.removeQueries({ queryKey: ['yt'] });
  log('auth', 'signed out');
}

async function runYtLibrarySync(): Promise<void> {
  if (!isSignedIn()) return;
  useAuth.setState({ syncing: true });
  try {
    resetTouched();
    const { getYtLibrary } = await import('../youtube/api');
    const lib = await getYtLibrary();
    if (!isSignedIn()) return; // signed out while fetching
    const { removed, skipped } = applyYtLibrary(lib);
    useAuth.setState({ lastSyncAt: Date.now() });
    log('auth', `library synced: ${lib.liked.length} liked, ${lib.playlists.length} playlists, ${lib.albums.length} albums, ${lib.artists.length} artists; removed ${removed}${skipped.length ? `, kept local (${skipped.join(', ')})` : ''}`);
  } catch (e) {
    logWarn('auth', 'library sync failed', e instanceof Error ? e.message : e);
  } finally {
    useAuth.setState({ syncing: false });
  }
}

const ytLibrarySync = serialRunner(runYtLibrarySync);

/**
 * Pulls the account's library into the YT-sourced rows (CarPlay and the Library tab read those). One run at a time: a request during a
 * run is coalesced into one follow-up run. Never deletes local items from an empty or truncated response (see library/syncPlan).
 */
export function syncYtLibrary(): Promise<void> {
  return ytLibrarySync.request();
}

/** Playback reporting (opt-in): called for every newly played track. */
const isRepeatReport = repeatGuard();

export function maybeReportPlayback(track: Track): void {
  if (!isSignedIn() || !useAuth.getState().reportHistory || isLocalId(track.id) || isRepeatReport(track.id)) return;
  reportYtPlayback(track.id).catch((e) => logWarn('auth', 'report playback failed', e instanceof Error ? e.message : e));
}
