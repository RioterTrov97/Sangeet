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
import { getJson, setJson } from '../util/storage';
import { reportYtPlayback, setAuthCookie, setAuthErrorHandler, setYtLike, setYtSubscribe } from '../youtube/api';
import type { Artist, Track } from '../youtube/models';
import { queryClient } from '../youtube/queryClient';
import { headerHasAuth, mergeCookies, MUSIC_ORIGIN, toCookieHeader, hasAuthCookie } from './cookies';

/**
 * Optional YouTube sign-in. The cookie header lives only in the keychain (expo-secure-store) and in youtubei.js's
 * in-memory session; it is never logged, never put in a URL, and never sent to the stream extractor (which stays
 * anonymous: age-restricted playback is the only case that might need it).
 */
export type AuthStatus = 'anon' | 'signedIn' | 'expired';

const COOKIE_KEY = 'yt.cookie.v1';
const PREFS_KEY = 'auth.prefs.v1';

export const useAuth = create<{ status: AuthStatus; reportHistory: boolean; syncing: boolean; lastSyncAt?: number }>(() => ({
  status: 'anon',
  reportHistory: getJson<{ reportHistory?: boolean }>(PREFS_KEY)?.reportHistory ?? false,
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

/** Restores a saved session at boot (keychain read is async). Never throws. */
export async function initAuth(): Promise<void> {
  try {
    const header = await SecureStore.getItemAsync(COOKIE_KEY);
    if (header && headerHasAuth(header)) {
      activate(header);
      log('auth', 'session restored');
      void syncYtLibrary();
    }
  } catch (e) {
    logWarn('auth', 'restore failed', e instanceof Error ? e.message : e);
  }
}

/** Reads the cookies the sign-in WebView collected (WebKit store). Returns the header when it holds an auth cookie. */
export async function captureCookies(): Promise<string | undefined> {
  const maps = await Promise.all([CookieManager.get(MUSIC_ORIGIN, true), CookieManager.get('https://www.youtube.com', true), CookieManager.get('https://accounts.google.com', true)]);
  const merged = mergeCookies(...maps.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { value: v.value, domain: v.domain }]))));
  return hasAuthCookie(merged) ? toCookieHeader(merged) : undefined;
}

export async function completeSignIn(header: string): Promise<void> {
  await SecureStore.setItemAsync(COOKIE_KEY, header, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  activate(header);
  queryClient.removeQueries({ queryKey: ['yt'] }); // anonymous Home etc. must not be shown as personalised
  log('auth', 'signed in');
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
  useAuth.setState({ status: 'anon', syncing: false });
  await SecureStore.deleteItemAsync(COOKIE_KEY).catch(() => {});
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
export function maybeReportPlayback(track: Track): void {
  if (!isSignedIn() || !useAuth.getState().reportHistory || isLocalId(track.id)) return;
  reportYtPlayback(track.id).catch((e) => logWarn('auth', 'report playback failed', e instanceof Error ? e.message : e));
}
