import { PlayerQueue, TrackPlayer, type TrackItem } from 'react-native-nitro-player';

import { maybeReportPlayback } from '../auth/store';
import { autoArtworkUrl, autoCachedTracks, isAvailableOffline, setAutoCacheProtect } from '../downloads/autoCache';
import { downloadedTracks, localArtworkUrl, localAudioUrl, markPlayed } from '../downloads/manager';
import { isOffline, onNetChange } from '../downloads/net';
import { offlineFailurePlan, offlineSongs, offlineTopUp } from '../downloads/offline';
import { isLocalId, localSongArt, localSongUrl, localTracks } from '../local';
import { log, logWarn } from '../util/log';
import { showNotice } from '../util/notice';
import { getJson, setJson, storage } from '../util/storage';
import { getUpNext } from '../youtube/api';
import { radioFilter } from '../video/logic';
import type { Track } from '../youtube/models';
import { pickArtwork } from '../youtube/mappers/common';
import { startAudioEvents } from './audioEvents';
import { recordPlayed } from './history';
import { FailureGuard } from './failureGuard';
import { MIN_STARTED_S, RecoverGuard, StartRetry } from './recover';
import { intent } from './intent';
import { whenStartupReady } from '../util/startup';
import { ensureProxyAlive, prefetch, refreshStream, setPrefetchFilter, startProxy, trackUrl } from './proxy';
import { failureHaltsQueue, failureMessage } from '../youtube/resolver/lastFailure';
import * as model from './queueModel';
import { isRemote, remoteRoute } from './remoteFlag';
import { startSeekHold } from './seekHold';
import { restartsOpenVideo, videoFlag } from './videoFlag';
import { activeSwap, endSwap, isSpuriousChange, restorePosition } from './swapGuard';
import { parseSession, shouldRestoreAtLaunch, type SessionRecord } from './launchRestore';
import { playerState, setPlayerState, usePlayerStore, type RepeatMode } from './store';

/**
 * Queue controller. The Zustand store is the source of truth for the queue; a single native
 * nitro-player playlist mirrors it so the native side handles gapless advance, lock screen and CarPlay.
 * Queue items are unique by videoId.
 */

setPrefetchFilter((id) => isAvailableOffline(id) || isOffline());
// The current song and the next two are never evicted from the automatic offline cache.
setAutoCacheProtect(() => {
  const s = playerState();
  return new Set(s.queue.slice(Math.max(0, s.index), s.index + 3).map((t) => t.id));
});

let playlistId: string | undefined;
let playlistSeq = 0;
let tapAt = 0;
/** When the last Next / Previous / skip-to was pressed; the video controller logs its stages against it. */
let skipTapAt = 0;
/** ms since the press, or -1 when there is none in flight (cleared by endSkipTap, and stale after 30 s). */
export const sinceSkipTap = (): number => (skipTapAt && Date.now() - skipTapAt < 30000 ? Date.now() - skipTapAt : -1);
/** The press is over (the video is playing): later track changes (deep links, the queue sheet, auto-advance) are not timed against it. */
export const endSkipTap = (): void => void (skipTapAt = 0);
let pendingSeek = 0;
let configured: Promise<void> | undefined;
let userStarted = false;
/**
 * A song waiting for the network: one cut off mid-play (shown paused), or one the user picked while offline that is not
 * downloaded (shown loading). It plays from `position` when the network is back; any user-started playback or a pause clears it.
 */
let waitingFor: { id: string; index: number; position: number; loader: boolean } | null = null;
let netWaitOff: (() => void) | undefined;
/**
 * Offline, the song on screen needs the network (set with `waitingFor`, kept when the user pauses the wait). Its audio item
 * fails, and the native player then moves on to the next item by itself: those moves are ignored, and Next / Previous / play
 * work from the song on screen. Cleared by any user-started playback (skip, a new queue, back-online reload).
 */
let offlineHold: { id: string; index: number } | null = null;
/**
 * The native player left the song on screen by itself because its item failed (not because it ended): it auto-advanced
 * to the next item. The song on screen stays current; nothing plays until a retry or the user's play reloads it.
 */
let awayFrom: { id: string; index: number } | null = null;
/** The native player may sit on another item than the song on screen: move by absolute index, reload on play. */
const nativeAway = () => offlineHold ?? awayFrom;
let lastFailureAt = 0;
/** Last time a move to another song was asked for (a skip, a new queue, lock screen / CarPlay Next or Previous). */
let userMoveAt = 0;
export const noteUserMove = (): void => void (userMoveAt = Date.now());
/** True when a native track change can be the answer to a move someone asked for (not the player moving by itself). */
export const userMovedRecently = (): boolean => Date.now() - userMoveAt < 5000;
const FAILURE_DEDUPE_MS = 500; // shorter than the first retry delays (RECOVER_BACKOFF_MS[0], START_RETRY_MS[0])
/** True while the current song waits for the network with a loader: the bridge keeps showing it as buffering, not paused. */
export const waitingWithLoader = (): boolean => !!waitingFor?.loader && playerState().queue[playerState().index]?.id === waitingFor.id;

/** Where the player is pointed for a local song whose file is no longer in the index: nothing there, so it fails and shows Retry. */
const MISSING_LOCAL_URL = 'file:///missing-local-song.m4a';

export function toItem(t: Track): TrackItem {
  return {
    id: t.id,
    title: t.title,
    artist: t.artists.map((a) => a.name).join(', '),
    album: t.album?.name ?? '',
    duration: t.durationSec ?? 0,
    // A song from this iPhone and a downloaded track play from their local file (works offline, in CarPlay and with no extractor
    // round trip). A local id never goes to the stream proxy: when its file is gone the item fails like any failed song.
    url: isLocalId(t.id) ? (localSongUrl(t.id) ?? MISSING_LOCAL_URL) : (localAudioUrl(t.id) ?? trackUrl(t.id)),
    artwork: localSongArt(t.id) ?? localArtworkUrl(t.id) ?? autoArtworkUrl(t.id) ?? pickArtwork(t.artwork, 544) ?? null,
  };
}

/** Starts the proxy + extractor host and configures the native player, once. Safe to call from any entry path. */
export function ensurePlayerReady(): Promise<void> {
  configured ??= (async () => {
    await startProxy();
    await TrackPlayer.configure({
      androidAutoEnabled: false,
      carPlayEnabled: true,
      showInNotification: true,
      // CarPlay Now Playing buttons (toggles). The app owns shuffle/repeat state; see nowPlayingButtons.ts.
      notificationButtons: {
        ios: {
          carPlay: [
            { id: 'shuffle', type: 'image', icon: 'shuffle', activeIcon: 'shuffle.circle.fill' },
            { id: 'repeat', type: 'image', icon: 'repeat', activeIcon: 'repeat.circle.fill' },
          ],
        },
      },
    });
    startAudioEvents();
  })();
  return configured;
}

/** Replaces the native playlist with the current model (used for new queues and rebuilds). */
async function loadNative(queue: Track[], index: number): Promise<void> {
  const old = playlistId;
  const id = await PlayerQueue.createPlaylist(`Queue ${++playlistSeq}`);
  await PlayerQueue.addTracksToPlaylist(id, queue.map(toItem));
  playlistId = id;
  awayFrom = null; // the native player is on the queue again
  await PlayerQueue.loadPlaylist(id, index);
  if (old) PlayerQueue.deletePlaylist(old).catch(() => {});
}

/** play() right after a load is ignored until the item is ready, so retry for a few seconds. */
let lastPlayingAt = 0;
export const markPlaying = () => {
  lastPlayingAt = Date.now();
  failures.reset();
  startRetries.reset();
};
let ensuring = false;
/** True while the user asked for playback recently (a load/skip/toggle in the last 12 s) and nothing cancelled it. */
export const wantsPlayback = () => intent.active();

async function ensurePlaying(): Promise<void> {
  intent.request();
  if (ensuring) return;
  ensuring = true;
  try {
    await ensureLoop();
  } finally {
    ensuring = false;
  }
}

async function ensureLoop(): Promise<void> {
  const token = intent.token();
  for (let i = 0; i < 30; i++) {
    if (intent.cancelledSince(token)) return log('queue', 'start loop cancelled (user/system pause)');
    if (nativeAway()) return log('queue', 'start loop stopped: the native player is not on the current song');
    await TrackPlayer.play();
    await new Promise((r) => setTimeout(r, 250));
    const s = await TrackPlayer.getState();
    if (s.currentState === 'playing' || s.currentState === 'buffering') return;
    if (intent.cancelledSince(token)) return log('queue', 'start loop cancelled (user/system pause)');
  }
  logWarn('queue', 'player never started');
}

/** `startAt`: seconds to seek to once audio starts (queue handover from another device). */
/** `reload`: `tracks` is the current queue, loaded again (shuffle state and user-added marks are kept). */
export type PlayOpts = { source?: string; sourceName?: string; shuffle?: boolean; startAt?: number; reload?: boolean };

export async function playTracks(tracks: Track[], startIndex = 0, opts: PlayOpts = {}): Promise<void> {
  if (remoteRoute.handlers) return remoteRoute.handlers.playTracks(tracks, startIndex, opts);
  return playTracksLocal(tracks, startIndex, opts);
}

/** Always plays on this device (CarPlay, remote handback). Ends any remote-control session first. */
export async function playTracksLocal(tracks: Track[], startIndex = 0, opts: PlayOpts = {}): Promise<void> {
  endSwap();
  remoteRoute.release?.();
  tapAt = Date.now();
  noteUserMove();
  waitingFor = null; // user-started playback disarms "continue when back online"
  offlineHold = null;
  endedAtTail = false;
  if (!opts.reload) radioSpent.clear();
  failures.reset(); // a deliberate start gets a fresh failure budget
  endSkipTap(); // a new queue is not a Next press
  const start = tracks[startIndex];
  if (!start) return;
  const openId = playerState().queue[playerState().index]?.id;
  userStarted = true; // a restore still in flight must not overwrite this queue
  await ensurePlayerReady();
  let queue = model.dedupe(tracks);
  let index = queue.findIndex((t) => t.id === start.id);
  let original: Track[] | null = null;
  if (opts.shuffle) {
    original = queue;
    ({ queue, index } = model.shuffleKeepingCurrent(queue, index));
  }
  pendingSeek = opts.startAt ?? 0;
  // In video mode the video plays from this position; set before loading, which fires the track change the video follows.
  videoFlag.startAt = videoFlag.active && opts.startAt && !opts.reload && !restartsOpenVideo(true, openId, start.id) ? { id: start.id, sec: opts.startAt } : undefined;
  const prev = playerState();
  const keep = opts.reload ? { original: prev.original, shuffle: prev.shuffle, userAdded: prev.userAdded } : { original, shuffle: !!opts.shuffle, userAdded: [] };
  setPlayerState({ queue, index, ...keep, source: opts.source, sourceName: opts.sourceName, position: opts.startAt ?? 0, duration: start.durationSec ?? 0, status: 'buffering' });
  log('queue', `playTracks ${queue.length} tracks start=${start.id} source=${opts.source ?? '-'} shuffle=${!!opts.shuffle}`);
  await loadNative(queue, index);
  if (isOffline() && !isAvailableOffline(start.id) && !videoFlag.active) {
    // Offline and the song needs the network: it becomes current, loading, and starts once the network is back.
    waitForNetwork(start.id, index, opts.startAt ?? 0, true);
    return;
  }
  await TrackPlayer.playSong(start.id, playlistId);
  if (videoFlag.active) {
    // The video owns playback: keep the native audio quiet. Same track again: no track-change event will restart it.
    void TrackPlayer.pause().catch(() => {});
    pendingSeek = 0; // the video applies a start position (videoFlag.startAt), not the quiet native audio
    if (restartsOpenVideo(true, openId, start.id)) {
      videoFlag.hooks?.seek(opts.startAt ?? 0);
      videoFlag.hooks?.play();
      setPlayerState({ status: 'playing' });
    }
  } else void ensurePlaying().then(applyPendingSeek);
  afterTrackChange();
}

/** A reload's start position must not depend on a native track-change event: once playback started, apply it if the first-audio hook has not already. */
function applyPendingSeek(): void {
  if (pendingSeek > 0) {
    const at = pendingSeek;
    pendingSeek = 0;
    void TrackPlayer.seek(at).catch(() => {});
  }
}

/** Reloads the current queue item and starts it at `sec` (used when the audio item came back idle / errored after a video handover). */
export async function reloadAudioAt(sec: number, play: boolean): Promise<void> {
  const s = playerState();
  if (!s.queue[s.index]) return;
  logWarn('queue', `reloading ${s.queue[s.index].id} at ${sec.toFixed(1)}s`);
  if (play) intent.request();
  await playTracksLocal(s.queue, s.index, { source: s.source, sourceName: s.sourceName, startAt: sec, reload: true });
}

export async function playNext(track: Track): Promise<void> {
  if (remoteRoute.handlers) return remoteRoute.handlers.playNext(track);
  const s = playerState();
  if (!s.queue.length) return playTracks([track], 0, { source: 'play-next' });
  await ensurePlayerReady();
  const { queue, index } = model.insertNext(s.queue, s.index, track);
  if (queue === s.queue) return;
  const existing = s.queue.some((t) => t.id === track.id);
  if (existing) await PlayerQueue.removeTrackFromPlaylist(playlistId!, track.id);
  await PlayerQueue.addTrackToPlaylist(playlistId!, toItem(track), index + 1);
  setPlayerState({ queue, index, userAdded: [...s.userAdded.filter((i) => i !== track.id), track.id], original: s.original ? model.append(s.original, [track]) : null });
  prefetch(track.id);
}

export async function addToQueue(track: Track): Promise<void> {
  if (remoteRoute.handlers) return remoteRoute.handlers.addToQueue(track);
  const s = playerState();
  if (!s.queue.length) return playTracks([track], 0, { source: 'queue' });
  if (s.queue.some((t) => t.id === track.id)) return;
  await ensurePlayerReady();
  await PlayerQueue.addTrackToPlaylist(playlistId!, toItem(track));
  setPlayerState({ queue: [...s.queue, track], userAdded: [...s.userAdded, track.id], original: s.original ? [...s.original, track] : null });
}

export async function removeFromQueue(position: number): Promise<void> {
  if (remoteRoute.handlers) return;
  const s = playerState();
  const track = s.queue[position];
  if (!track || position === s.index) return;
  const { queue, index } = model.removeAt(s.queue, s.index, position);
  setPlayerState({ queue, index, original: s.original ? s.original.filter((t) => t.id !== track.id) : null });
  await PlayerQueue.removeTrackFromPlaylist(playlistId!, track.id);
}

export async function moveInQueue(from: number, to: number): Promise<void> {
  if (remoteRoute.handlers) return;
  const s = playerState();
  const track = s.queue[from];
  if (!track) return;
  const r = model.move(s.queue, s.index, from, to);
  setPlayerState({ queue: r.queue, index: r.index });
  if (from === s.index) {
    await PlayerQueue.reorderTrackInPlaylist(playlistId!, track.id, to);
  } else {
    // reorderTrackInPlaylist re-anchors playback to the old index; remove + insert keeps the current track.
    await PlayerQueue.removeTrackFromPlaylist(playlistId!, track.id);
    await PlayerQueue.addTrackToPlaylist(playlistId!, toItem(track), to);
  }
}

export async function clearUpcoming(): Promise<void> {
  if (remoteRoute.handlers) return;
  const s = playerState();
  const drop = s.queue.slice(s.index + 1).map((t) => t.id);
  if (!drop.length) return;
  setPlayerState({ queue: model.clearUpcoming(s.queue, s.index), original: s.original ? s.original.filter((t) => !drop.includes(t.id)) : null });
  await PlayerQueue.removeTracksFromPlaylist(playlistId!, drop);
}

/** Rewrites the native playlist around the current track without interrupting it. */
async function reorderNativeAround(queue: Track[], index: number): Promise<void> {
  const current = queue[index];
  const pid = playlistId!;
  const others = (await Promise.resolve(PlayerQueue.getPlaylist(pid)))?.tracks.filter((t) => t.id !== current.id).map((t) => t.id) ?? [];
  if (others.length) await PlayerQueue.removeTracksFromPlaylist(pid, others);
  const before = queue.slice(0, index).map(toItem);
  const after = queue.slice(index + 1).map(toItem);
  if (before.length) await PlayerQueue.addTracksToPlaylist(pid, before, 0);
  if (after.length) await PlayerQueue.addTracksToPlaylist(pid, after);
}

export async function setShuffle(on: boolean): Promise<void> {
  if (remoteRoute.handlers) return remoteRoute.handlers.setShuffle(on);
  const s = playerState();
  if (on === s.shuffle || !s.queue.length) return setPlayerState({ shuffle: on });
  const cur = s.queue[s.index].id;
  let queue: Track[];
  let original: Track[] | null = null;
  if (on) {
    original = s.queue;
    queue = model.shuffleKeepingCurrent(s.queue, s.index).queue;
  } else {
    queue = model.unshuffle(s.queue, s.original ?? s.queue).queue;
  }
  const index = queue.findIndex((t) => t.id === cur);
  setPlayerState({ queue, index, original, shuffle: on });
  await reorderNativeAround(queue, index);
}

export async function setRepeat(mode: RepeatMode): Promise<void> {
  if (remoteRoute.handlers) return remoteRoute.handlers.setRepeat(mode);
  setPlayerState({ repeat: mode });
  await TrackPlayer.setRepeatMode(mode === 'all' ? 'Playlist' : mode === 'one' ? 'track' : 'off');
  afterTrackChange();
}

export const togglePlay = async () => {
  if (remoteRoute.handlers) return remoteRoute.handlers.togglePlay();
  if (videoFlag.active) return videoFlag.hooks?.toggle();
  const s = playerState();
  if (waitingFor?.loader) {
    // Pause while a picked song waits for the network: stop waiting (it will not start by itself any more).
    waitingFor = null;
    netWaitOff?.();
    setPlayerState({ status: 'paused' });
    return;
  }
  const away = nativeAway();
  if (away && s.queue[s.index]?.id === away.id && s.status !== 'playing') {
    // Play on a song the native player is not on (its item failed). Offline and not saved: wait again; else load it now.
    if (isOffline() && !isAvailableOffline(away.id)) return waitForNetwork(away.id, s.index, s.position, true);
    await ensureProxyAlive();
    return void reloadAudioAt(s.position, true);
  }
  if (s.status === 'playing' || s.status === 'buffering') {
    intent.cancel('user');
    return TrackPlayer.pause();
  }
  intent.request();
  await ensureProxyAlive(); // after a long pause the proxy socket may be gone; saved songs are served through it too
  void ensurePlaying();
};
/** Skips keep playing: the native player pauses while the next item loads and ignores an early play(). */
async function skipWith(fn: () => Promise<unknown>, target?: Track, quiet = false): Promise<void> {
  endSwap(); // a deliberate skip is never a spurious swap advance
  waitingFor = null;
  offlineHold = null;
  skipTapAt = Date.now();
  noteUserMove();
  if (videoFlag.active && !quiet) videoFlag.hooks?.skipping(target); // the video starts loading now, not when the native player reports the change
  const wasPlaying = playerState().status !== 'paused' && playerState().status !== 'idle';
  tapAt = Date.now();
  log('queue', `skip (wasPlaying=${wasPlaying}, status=${playerState().status}, video=${videoFlag.active})`);
  await fn();
  // Video mode: the native audio player must stay silent; the video controller reacts to the track change.
  if (videoFlag.active) return void TrackPlayer.pause().catch(() => {});
  if (wasPlaying && !waitingWithLoader()) void ensurePlaying(); // offline on a picked song: it waits for the network instead
}
/** The track a skip forward lands on, when the store can tell (not repeat-one, not past the end of a non-repeating queue). */
function nextTarget(): Track | undefined {
  const s = playerState();
  if (s.repeat === 'one') return undefined;
  return s.queue[s.index + 1] ?? (s.repeat === 'all' && s.queue.length > 1 ? s.queue[0] : undefined);
}
export const skipNext = () => {
  if (remoteRoute.handlers) return Promise.resolve(remoteRoute.handlers.skipNext());
  // Held for the network, or left after a failure: the native player may be on another item, so move from the song on screen.
  if (nativeAway()) {
    const s = playerState();
    const to = s.index + 1 < s.queue.length ? s.index + 1 : s.repeat === 'all' ? 0 : -1;
    return to >= 0 && to !== s.index ? skipToIndex(to) : Promise.resolve();
  }
  if (!nextTarget() && playerState().repeat === 'off' && playerState().queue.length) {
    // Next on the last song: related songs are on their way (or fetched now); continue with the first of them.
    endedAtTail = true;
    void fillRadio();
    return Promise.resolve();
  }
  return skipWith(() => TrackPlayer.skipToNext(), nextTarget());
};
export const skipPrevious = () => {
  if (remoteRoute.handlers) return Promise.resolve(remoteRoute.handlers.skipPrevious());
  if (nativeAway()) return playerState().index > 0 ? skipToIndex(playerState().index - 1) : Promise.resolve();
  // The native player is paused at the switch position in video mode, so decide "restart vs previous" here.
  if (videoFlag.active && playerState().position > 3) return Promise.resolve(videoFlag.hooks?.seek(0));
  return skipWith(() => TrackPlayer.skipToPrevious());
};
export const seekTo = (sec: number) => {
  if (remoteRoute.handlers) return Promise.resolve(remoteRoute.handlers.seekTo(sec));
  startSeekHold(sec);
  setPlayerState({ position: sec });
  if (videoFlag.active) return Promise.resolve(videoFlag.hooks?.seek(sec));
  return TrackPlayer.seek(sec);
};

/** Resumes audio at `sec` (used when leaving video mode). */
export async function resumeAudioAt(sec: number, play: boolean): Promise<void> {
  await TrackPlayer.seek(sec);
  if (play) void ensurePlaying();
}
/** `quiet`: an internal move (restoring the queue position after a source swap), not a press: no video preview. */
export const skipToIndex = (i: number, quiet = false) => {
  if (remoteRoute.handlers) return Promise.resolve(remoteRoute.handlers.skipToIndex(i));
  if (nativeAway() && !quiet && !videoFlag.active) {
    // Held for the network (or left after a failure): the native player may already sit on item `i` (no track-change would follow), so load the queue
    // at `i`: it plays if saved, else waits for the network the same way.
    const s = playerState();
    if (!s.queue[i]) return Promise.resolve();
    return playTracksLocal(s.queue, i, { source: s.source, sourceName: s.sourceName, reload: true });
  }
  return skipWith(() => TrackPlayer.skipToIndex(i), quiet || i === playerState().index ? undefined : playerState().queue[i], quiet);
};

// ---- reactions to native events (called by PlayerBridge) ----

/** Native player moved to `id`. */
export function onNativeTrackChanged(id: string): void {
  // An audio<->video swap is in flight: the outgoing source ending is not a real advance; the swap's heal step restores the track.
  if (isSpuriousChange(id)) return void log('queue', `ignored native change to ${id} during source swap`);
  const away = nativeAway();
  if (away) {
    // The song's item failed and the native player moved on by itself: keep the song on screen, nothing plays.
    if (id !== away.id) {
      log('queue', `ignored native move to ${id} (staying on ${away.id}${offlineHold ? ', offline' : ''})`);
      void TrackPlayer.pause().catch(() => {});
    }
    return;
  }
  const known = playerState().queue.find((t) => t.id === id);
  if (known) recordPlayed(known, playerState().source);
  markPlayed(id);
  if (known) maybeReportPlayback(known);
  if (isOffline() && !isAvailableOffline(id)) {
    // Picked (queue, Next, Previous) or reached by auto-advance: it becomes current, loading, and plays once the network is back.
    const i = playerState().queue.findIndex((t) => t.id === id);
    if (i < 0) return;
    setPlayerState({ index: i, position: 0, duration: playerState().queue[i].durationSec ?? 0 });
    waitForNetwork(id, i, 0, true);
    return;
  }
  // Auto-advance while playing: keep the "user wants playback" window open so a stall-pause at the start is nudged.
  if (Date.now() - lastPlayingAt < 5000) intent.request();
  const s = playerState();
  const i = s.queue.findIndex((t) => t.id === id);
  if (i < 0) return;
  setPlayerState({ index: i, position: 0, duration: s.queue[i].durationSec ?? 0 });
  afterTrackChange();
  if (videoFlag.active) videoFlag.hooks?.trackChanged(id);
}

/**
 * The native player moved from `failedId` to `movedTo` although the song had not ended (at `atSec` of a longer song): its
 * item failed (a dead stream, or the local proxy gone after the app sat suspended) and AVQueuePlayer advanced by itself.
 * The player never switches songs on its own: stay on `failedId` and handle it as a failure (retry, then pause with Retry).
 */
export function onNativeFailedAdvance(failedId: string, movedTo: string, atSec: number): void {
  const s = playerState();
  if (nativeAway() || isSpuriousChange(movedTo) || s.queue[s.index]?.id !== failedId) return onNativeTrackChanged(movedTo);
  logWarn('queue', `native player left ${failedId} at ${atSec.toFixed(0)}s for ${movedTo} before it ended (item failed); staying on ${failedId}`);
  void TrackPlayer.pause().catch(() => {});
  setPlayerState({ position: atSec });
  // Its error may already have been reported and handled (onPlaybackFailed skips a duplicate report within a moment).
  onPlaybackFailed();
  // Until something reloads the queue (a retry, Retry, play, a skip), the native player is not on this song.
  if (!offlineHold) awayFrom = { id: failedId, index: s.index };
}

export function onFirstAudio(trackId: string): void {
  if (tapAt) log('play', `AUDIO STARTED ${trackId} trigger->sound ${Date.now() - tapAt}ms`);
  tapAt = 0;
  if (pendingSeek > 0) {
    void TrackPlayer.seek(pendingSeek);
    pendingSeek = 0;
  }
}

export function markSkipStart(): void {
  tapAt = Date.now();
}

export function afterTrackChange(): void {
  const s = playerState();
  const upcoming = s.queue.slice(s.index + 1, s.index + 3);
  whenStartupReady(() => upcoming.forEach((t) => prefetch(t.id))); // TV: not during the first seconds after launch
  if (model.needsRadio(s.queue, s.index, s.repeat) && !s.loadingRadio) void fillRadio();
}

/** Seeds that gave no new songs (tried again only once the queue changes); cleared by a new queue. */
const radioSpent = new Set<string>();
let radioFails = 0;
let radioRetry: ReturnType<typeof setTimeout> | undefined;
let radioNetHook = false;
/** The queue ran out (the last song ended, or Next was pressed on it): play the first related song once it arrives. */
let endedAtTail = false;

/**
 * Endless queue: tops the queue up with related songs (YouTube Music radio) whatever started it (album, playlist, artist,
 * liked, a song). Tries other seeds when one gives nothing new, retries a failed fetch (5 s, 15 s, 45 s) and when the
 * network comes back. Repeat all / one loop instead.
 */
export async function fillRadio(): Promise<void> {
  const s = playerState();
  if (!s.queue.length || s.loadingRadio || remoteRoute.handlers) return;
  if (!radioNetHook) {
    radioNetHook = true;
    onNetChange(() => {
      const n = playerState();
      if (!isOffline() && (endedAtTail || model.needsRadio(n.queue, n.index, n.repeat))) void fillRadio();
    });
  }
  if (isOffline()) return void fillOffline(); // saved songs now; the network hook above fetches related songs once back online
  // A local song is no seed for YouTube's radio. A queue of nothing but local songs is topped up from the other local songs instead.
  const youtube = s.queue.filter((t) => !isLocalId(t.id));
  if (!youtube.length) return void fillFromPool(localTracks(), false);
  const seeds = model.radioSeeds(youtube, Math.max(0, youtube.findIndex((t) => t.id === s.queue[s.index]?.id))).filter((t) => !radioSpent.has(`${t.id}@${s.queue.length}`));
  if (!seeds.length) return;
  clearTimeout(radioRetry);
  setPlayerState({ loadingRadio: true });
  try {
    for (const seed of seeds) {
      const all = await getUpNext(seed.id);
      const next = radioFilter(all, seed);
      const before = playerState().queue.length;
      const fresh = model.append(playerState().queue, next).slice(before);
      log('queue', `radio seed=${seed.id}: ${all.length} candidates, ${all.length - next.length} uploads/covers dropped, ${fresh.length} new`);
      radioFails = 0;
      if (!fresh.length || !playlistId) {
        radioSpent.add(`${seed.id}@${s.queue.length}`);
        continue;
      }
      await PlayerQueue.addTracksToPlaylist(playlistId, fresh.map(toItem));
      const cur = playerState();
      setPlayerState({ queue: [...cur.queue, ...fresh], original: cur.original ? [...cur.original, ...fresh] : null });
      if (endedAtTail) continueAfterTail(before);
      return;
    }
    logWarn('queue', 'radio: no new related songs from any seed');
  } catch (e) {
    const wait = [5000, 15000, 45000][Math.min(radioFails, 2)];
    radioFails++;
    logWarn('queue', `radio failed (retry in ${wait / 1000}s)`, e instanceof Error ? e.message : e);
    radioRetry = setTimeout(() => {
      const n = playerState();
      if (endedAtTail || model.needsRadio(n.queue, n.index, n.repeat)) void fillRadio();
    }, wait);
  } finally {
    setPlayerState({ loadingRadio: false });
  }
}

/** Offline top-up from the songs saved on this device (related songs need the network). */
const fillOffline = (): Promise<void> => fillFromPool(offlineSongs(downloadedTracks(), autoCachedTracks(), localTracks()));

let poolFilling = false;
/**
 * Tops the queue up from `pool` (songs on this device): the ones not queued yet, else (`recycle`) the played ones go round again.
 * Online with a queue of local songs only the first happens: a queue is not reordered behind the user's back while the network is fine.
 */
async function fillFromPool(pool: Track[], recycle = true): Promise<void> {
  if (poolFilling) return;
  poolFilling = true;
  try {
    await topUpFromPool(pool, recycle);
  } finally {
    poolFilling = false;
  }
}

async function topUpFromPool(pool: Track[], recycle: boolean): Promise<void> {
  const s = playerState();
  const plan = offlineTopUp(s.queue, s.index, pool);
  if (!plan || !playlistId || (!recycle && 'recycle' in plan)) return;
  if ('append' in plan) {
    const before = s.queue.length;
    log('queue', `top-up: adding ${plan.append.length} songs from this device to the queue`);
    await PlayerQueue.addTracksToPlaylist(playlistId, plan.append.map(toItem));
    const cur = playerState();
    setPlayerState({ queue: [...cur.queue, ...plan.append], original: cur.original ? [...cur.original, ...plan.append] : null });
    if (endedAtTail) continueAfterTail(before);
    return;
  }
  // Every saved song is queued: the ones already played go round again at the end (shuffled), so the queue keeps going.
  const ids = new Set(plan.recycle.map((t) => t.id));
  log('queue', `top-up: every device song queued -> ${ids.size} played ones moved to the end for another round`);
  await PlayerQueue.removeTracksFromPlaylist(playlistId, [...ids]);
  await PlayerQueue.addTracksToPlaylist(playlistId, plan.recycle.map(toItem));
  const cur = playerState();
  const currentId = cur.queue[cur.index]?.id;
  const kept = cur.queue.filter((t) => !ids.has(t.id));
  const queue = [...kept, ...plan.recycle];
  setPlayerState({
    queue,
    index: Math.max(0, queue.findIndex((t) => t.id === currentId)),
    original: cur.original ? [...cur.original.filter((t) => !ids.has(t.id)), ...plan.recycle] : null,
  });
  if (endedAtTail) continueAfterTail(kept.length);
}

/** The last song ended with nothing after it (repeat off): fetch related songs and keep playing. */
export function onQueueEnded(): void {
  const s = playerState();
  if (s.repeat !== 'off' || !s.queue.length || s.index !== s.queue.length - 1 || remoteRoute.handlers) return;
  endedAtTail = true;
  log('queue', 'queue ended -> fetching related songs to keep playing');
  void fillRadio();
}

/** Related songs arrived after the queue ran out: start the first of them (`at`). */
function continueAfterTail(at: number): void {
  endedAtTail = false;
  const s = playerState();
  if (!s.queue[at] || s.index !== at - 1) return; // the user moved on meanwhile
  log('queue', `continuing with related song ${s.queue[at].id}`);
  intent.request();
  // The native queue is exhausted (no items left): load it again at the new song rather than skipping inside it.
  if (videoFlag.active) void skipToIndex(at);
  else void playTracksLocal(s.queue, at, { source: s.source, sourceName: s.sourceName, reload: true });
}

// ---- persistence ----

const KEY = 'player.queue.v1';
export type Persisted = { queue: Track[]; index: number; original: Track[] | null; shuffle: boolean; repeat: RepeatMode; position: number; source?: string };

/** Old position-only record (no longer written: reopening starts the song from the beginning); removed on clear. */
const POS_KEY = 'player.queue.pos.v1';

export function persistNow(): void {
  const s = playerState();
  if (!s.queue.length) return;
  setJson(KEY, { queue: s.queue, index: s.index, original: s.original, shuffle: s.shuffle, repeat: s.repeat, position: s.position, source: s.source } satisfies Persisted);
}

// ---- per-launch "played this session" flag (see launchRestore.ts) ----
const SESSION_KEY = 'player.session.v1';
let lastSessionPlayed: boolean | undefined;
let sessionPlayed = false;
/** Reads the previous session's flag, then marks this session as not played yet. Idempotent. */
function initSession(): void {
  if (lastSessionPlayed !== undefined) return;
  lastSessionPlayed = parseSession(getJson<SessionRecord>(SESSION_KEY));
  setJson(SESSION_KEY, { played: false, at: Date.now() } satisfies SessionRecord);
  usePlayerStore.subscribe((s, prev) => {
    if (sessionPlayed || s.status !== 'playing' || prev.status === 'playing' || isRemote()) return;
    sessionPlayed = true;
    setJson(SESSION_KEY, { played: true, at: Date.now() } satisfies SessionRecord);
  });
}

/** Boot entry: restores the saved queue paused only if the previous session played (otherwise no mini player until the user starts something). */
export async function restoreAtLaunch(): Promise<boolean> {
  initSession();
  const hasSavedQueue = !!getJson<Persisted>(KEY)?.queue?.length;
  if (!shouldRestoreAtLaunch({ hasSavedQueue, lastSessionPlayed: !!lastSessionPlayed })) return false;
  return restoreQueue();
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
export function startPersisting(): void {
  initSession();
  usePlayerStore.subscribe((s, prev) => {
    const queueChanged = s.queue !== prev.queue || s.index !== prev.index || s.shuffle !== prev.shuffle || s.repeat !== prev.repeat;
    const paused = s.status !== prev.status && s.status === 'paused';
    if (!queueChanged && !paused) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 500);
  });
}

let restoring: Promise<boolean> | undefined;
/** Restores the last queue paused at the start of the current song (once). */
export function restoreQueue(): Promise<boolean> {
  restoring ??= doRestore();
  return restoring;
}

/** CarPlay "Resume": plays the restored (or still-restoring) queue. */
export async function resumePlayback(): Promise<boolean> {
  remoteRoute.release?.(); // CarPlay always plays locally
  await ensurePlayerReady();
  if (!playerState().queue.length) await restoreQueue();
  if (!playerState().queue.length) return false;
  void ensurePlaying();
  return true;
}

async function doRestore(): Promise<boolean> {
  const p = getJson<Persisted>(KEY);
  if (!p?.queue?.length) return false;
  // Reopening the app starts the last song from the beginning, not from where it was (a TV handback and the
  // "Player closed" undo keep the exact position: they use loadPausedQueue / restoreClosedQueue).
  p.position = 0;
  await ensurePlayerReady();
  if (userStarted) return false;
  return loadPaused(p, true);
}

/** Loads a queue into the native player paused at `p.position` (app restore; queue handback from a TV). */
export async function loadPausedQueue(p: Persisted): Promise<void> {
  userStarted = true; // an app restore still in flight must not overwrite this queue
  await ensurePlayerReady();
  await loadPaused(p, false);
}

async function loadPaused(p: Persisted, yieldToUser: boolean): Promise<boolean> {
  const index = Math.min(p.index, p.queue.length - 1);
  pendingSeek = p.position;
  setPlayerState({ queue: p.queue, index, original: p.original, shuffle: p.shuffle, repeat: p.repeat, source: p.source, position: p.position, duration: p.queue[index].durationSec ?? 0, status: 'paused' });
  await loadNative(p.queue, index);
  if (yieldToUser && userStarted) return false;
  if (p.repeat !== 'off') await TrackPlayer.setRepeatMode(p.repeat === 'all' ? 'Playlist' : 'track');
  log('queue', `restored ${p.queue.length} tracks at index ${index}, position ${p.position.toFixed(0)}s`);
  return true;
}

/**
 * Native player went to `paused`: nudge it only if we are still inside a user-requested start AND the pause is not
 * attributable to the user or system. The remote-command / interruption event can land a beat after the native state
 * event, so the decision is re-checked after a short settle delay.
 */
export function onUnexpectedPause(): void {
  // The native player sits on another item than the song on screen: resuming would play the wrong song.
  if (!intent.shouldResumeOnPause() || waitingWithLoader() || nativeAway()) return;
  const token = intent.token();
  setTimeout(() => {
    if (nativeAway()) return;
    if (intent.cancelledSince(token) || !intent.shouldResumeOnPause()) {
      // The bridge showed this pause as buffering (start window); it is a real pause after all.
      if (playerState().status === 'buffering') setPlayerState({ status: 'paused' });
      return log('queue', 'pause was user/system initiated -> not resuming');
    }
    log('queue', 'pause during start window -> resuming');
    void ensurePlaying();
  }, PAUSE_SETTLE_MS);
}
const PAUSE_SETTLE_MS = 300;

/**
 * nitro-player already retried the failed item itself and gave up (`stopped` + reason `error`). The song stays current:
 * it is retried with a fresh stream, then paused with a Retry notice. The player never moves to another song by itself.
 */
const failures = new FailureGuard();
const recoveries = new RecoverGuard();
const startRetries = new StartRetry();
export function onPlaybackFailed(): void {
  // One failure can arrive twice (the native error event and the auto-advance it causes): handle it once.
  if (Date.now() - lastFailureAt < FAILURE_DEDUPE_MS) return void log('queue', 'same failure reported again; already handled');
  lastFailureAt = Date.now();
  const s = playerState();
  // The audio source failed right after a video -> audio swap (its paused stream went stale): reload the SAME track at the swap position instead of skipping to the next song.
  const sw = activeSwap();
  if (sw && s.queue[sw.index]?.id === sw.id) {
    const playing = s.status !== 'paused' && s.status !== 'idle';
    logWarn('queue', `audio failed during source swap; reloading ${sw.id} at ${sw.at.toFixed(1)}s instead of skipping`);
    intent.request();
    void playTracksLocal(s.queue, sw.index, { source: s.source, sourceName: s.sourceName, startAt: restorePosition(sw, Date.now(), playing) });
    return;
  }
  // Offline: the recovery/skip handling below would drop or skip the song, so decide here first.
  if (offlineHold) return; // already holding a song for the network (a failure of it, or of an item the player moved to)
  if (isOffline()) {
    const c = s.queue[s.index];
    const off = offlineFailurePlan({ availableOffline: !!c && isAvailableOffline(c.id), positionSec: s.position });
    // Never skip ahead offline: the song stays current and waits (loading if it never started, paused if it was cut off).
    if (off !== 'normal' && c) return waitForNetwork(c.id, s.index, s.position, off === 'start');
  }
  // A source error AFTER the song had started (network drop, expired URL): resume the same track at the same position, up to 3 times.
  const cur = s.queue[s.index];
  const plan = cur ? recoveries.next(cur.id, s.position) : null;
  if (cur && plan) {
    logWarn('queue', `recover ${cur.id} at ${plan.positionSec.toFixed(0)}s attempt ${plan.attempt}`);
    intent.request();
    const idx = s.index;
    setTimeout(() => {
      const now = playerState();
      if (now.queue[idx]?.id !== cur.id) return; // the user moved on meanwhile
      void refreshStream(cur.id) // a no-op for a local song: its file needs no new URL
        .catch(() => {})
        .then(() => playTracksLocal(now.queue, idx, { source: now.source, sourceName: now.sourceName, startAt: plan.positionSec }));
    }, plan.delayMs);
    return;
  }
  if (!cur) return;
  const typed = failureMessage(cur.id);
  // Rate limiting hits every song the same way: retrying only makes it worse, so go straight to the notice.
  const limited = failureHaltsQueue(cur.id);
  // A song cut off mid-song whose resumes are used up is not restarted from 0: it pauses where it was.
  const wait = limited || s.position >= MIN_STARTED_S ? null : startRetries.next(cur.id);
  if (wait != null) {
    // It never started (often a stream gone stale while the app sat unused): fetch a fresh one and start the same song again.
    logWarn('queue', `playback failed for ${cur.id} before it started; retrying it in ${wait}ms`);
    intent.request();
    const token = intent.token();
    setPlayerState({ status: 'buffering' });
    const idx = s.index;
    setTimeout(() => {
      const now = playerState();
      if (now.queue[idx]?.id !== cur.id || intent.cancelledSince(token)) return; // the user moved on or paused meanwhile
      void refreshStream(cur.id)
        .catch(() => {})
        .then(() => playTracksLocal(now.queue, idx, { source: now.source, sourceName: now.sourceName, reload: true }));
    }, wait);
    return;
  }
  const { count } = failures.failed();
  logWarn('queue', `playback failed for ${cur.id} (${count} in a row); staying on it, paused with Retry`);
  intent.cancel('user');
  void TrackPlayer.pause();
  setPlayerState({ status: 'paused' });
  showNotice(typed ?? "Can't play this song right now", 15_000, { label: 'Retry', onPress: () => void retryCurrent() });
}

/**
 * Offline on a song that needs the network: hold on it and play it from `position` once online (unless the user did
 * something meanwhile). `loader`: the user just picked it, so it shows as loading; otherwise (cut off mid-song) as paused.
 */
function waitForNetwork(id: string, index: number, position: number, loader = false): void {
  logWarn('queue', `offline: waiting for network to ${loader ? 'start' : 'continue'} ${id} at ${position.toFixed(0)}s`);
  intent.cancel('user');
  waitingFor = { id, index, position, loader };
  offlineHold = { id, index };
  void TrackPlayer.pause();
  setPlayerState({ status: loader ? 'buffering' : 'paused' });
  const text = loader ? "You're offline. This song will play when you're back online." : "You're offline. This song will continue when you're back online.";
  const songs = offlineSongs(downloadedTracks(), autoCachedTracks(), localTracks());
  showNotice(text, 15_000, songs.length ? { label: 'Play offline songs', onPress: () => void playOfflineSongs() } : undefined);
  netWaitOff?.();
  const w = waitingFor;
  const off = onNetChange(() => {
    if (waitingFor !== w) return off(); // the user started or paused something meanwhile
    if (isOffline()) return;
    off();
    waitingFor = null;
    offlineHold = null;
    const s = playerState();
    if (s.queue[s.index]?.id !== id || s.index !== w.index) return;
    log('queue', `back online: ${loader ? 'starting' : 'continuing'} ${id} at ${w.position.toFixed(0)}s`);
    void reloadAudioAt(w.position, true);
  });
  netWaitOff = off;
}

/** Offline: plays the songs saved on this device (downloads and automatically saved songs), shuffled. */
export async function playOfflineSongs(): Promise<void> {
  const songs = offlineSongs(downloadedTracks(), autoCachedTracks(), localTracks());
  if (!songs.length) return void showNotice('No songs are saved on this device yet');
  await playTracks(songs, Math.floor(Math.random() * songs.length), { source: 'downloads', sourceName: 'Offline songs', shuffle: true });
}

/** Retry button of the "Can't play right now" notice: reload the current track from the start. */
async function retryCurrent(): Promise<void> {
  failures.reset();
  startRetries.reset();
  recoveries.reset();
  const s = playerState();
  if (!s.queue[s.index]) return;
  await playTracks(s.queue, s.index, { source: s.source, sourceName: s.sourceName, shuffle: false });
}

/** The current local queue as a record, for Undo after closing the player (undefined when nothing is loaded). */
export function snapshotQueue(): Persisted | undefined {
  const s = playerState();
  if (!s.queue.length) return undefined;
  return { queue: s.queue, index: s.index, original: s.original, shuffle: s.shuffle, repeat: s.repeat, position: s.position, source: s.source };
}

/** Closes the local player: pauses, empties the queue and the saved queue (so the next launch starts clean). */
export async function closeLocalPlayer(): Promise<void> {
  intent.cancel('user');
  waitingFor = null;
  offlineHold = null;
  netWaitOff?.();
  endSwap(); // a video <-> audio swap's queue repair must not refill the queue being cleared
  clearTimeout(persistTimer);
  storage.remove(KEY);
  storage.remove(POS_KEY);
  setPlayerState({ queue: [], index: 0, original: null, status: 'idle', position: 0, duration: 0, source: undefined, sourceName: undefined, userAdded: [] });
  const old = playlistId;
  playlistId = undefined;
  await TrackPlayer.pause().catch(() => {});
  if (old) await PlayerQueue.deletePlaylist(old).catch(() => {});
}

/** Undo of `closeLocalPlayer`: the queue comes back paused at the same index and position, and is saved again. */
export async function restoreClosedQueue(p: Persisted): Promise<void> {
  await loadPausedQueue(p);
  persistNow();
}
