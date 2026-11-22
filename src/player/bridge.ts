import { TrackPlayer } from 'react-native-nitro-player';
// Not part of the package's public API; the hooks are React-only and a CarPlay-only launch has no React tree.
import { callbackManager } from 'react-native-nitro-player/src/hooks/callbackManager';

import { log, logWarn } from '../util/log';
import { intent } from './intent';
import { markPlaying, onPlaybackFailed, markSkipStart, onFirstAudio, onNativeFailedAdvance, onNativeTrackChanged, userMovedRecently, onQueueEnded, onUnexpectedPause, persistNow, waitingWithLoader } from './queue';
import { endedEarly } from './recover';
import { remoteRoute } from './remoteFlag';
import { seekHoldDrops } from './seekHold';
import { videoFlag } from './videoFlag';
import { playerState, setPlayerState } from './store';

let started = false;

/**
 * Mirrors nitro-player events into the Zustand store. Plain module (no React) so it also runs when CarPlay
 * launches the app with no phone UI. Safe to call repeatedly.
 */
export function startPlayerBridge(): void {
  if (started) return;
  started = true;
  let lastPos = 0;
  let audioFor: string | undefined;
  let baseline = 0;
  let curPos = 0;
  let curTrack: string | undefined;
  let curState: string = 'stopped';
  let lastErrorAt = 0;

  callbackManager.subscribeToTrackChange((track, reason) => {
    const prev = curTrack;
    const prevAt = curPos;
    const prevSounded = !!prev && audioFor === prev;
    if (reason === 'end') markSkipStart();
    curTrack = track.id;
    audioFor = undefined;
    baseline = curPos; // position of the previous track; ignore it until it moves
    curPos = 0;
    if (remoteRoute.handlers) return;
    // nitro-player reports every item change as "skip". A move nobody asked for, away from a song that had not reached its
    // end and either never made a sound or just reported an error, is AVQueuePlayer moving past a failed item.
    const prevDur = prev ? (playerState().queue.find((t) => t.id === prev)?.durationSec ?? 0) : 0;
    const failed = !prevSounded || Date.now() - lastErrorAt < 15_000;
    if (reason !== 'repeat' && !videoFlag.active && prev && prev !== track.id && !userMovedRecently() && failed && endedEarly(prevAt, prevDur)) {
      return onNativeFailedAdvance(prev, track.id, prevAt);
    }
    onNativeTrackChanged(track.id);
  });

  callbackManager.subscribeToPlaybackState((state, reason) => {
    if (state !== curState || reason) log('bridge', `native ${state}${reason ? ` (${reason})` : ''} at ${curPos.toFixed(1)}s`);
    curState = state;
    if (remoteRoute.handlers) {
      // The TV owns playback: a lock-screen / headset play must not start the (paused) local copy of the queue.
      if (state === 'playing') void TrackPlayer.pause().catch(() => {});
      return;
    }
    if (videoFlag.active) return; // the video player owns status while video mode is on
    if (state === 'stopped' && reason === 'error') {
      lastErrorAt = Date.now();
      onPlaybackFailed();
    }
    // An item that could not be opened (a local file that is missing or unreadable) is reported as "end" at 0s: that is a failed
    // song, which stays on screen with Retry, not a finished one that would start related songs.
    const curDur = curTrack ? (playerState().queue.find((t) => t.id === curTrack)?.durationSec ?? 0) : 0;
    const endedUnplayed = reason === 'end' && !!curTrack && audioFor !== curTrack && endedEarly(curPos, curDur);
    if (endedUnplayed) {
      logWarn('bridge', `${curTrack} ended at ${curPos.toFixed(1)}s of ${curDur}s without making a sound; treating it as failed`);
      lastErrorAt = Date.now();
      onPlaybackFailed();
    } else if ((state === 'paused' || state === 'stopped') && reason === 'end') onQueueEnded(); // the last song ended: keep going with related songs
    // A pause inside the start window is a load stall the queue is about to nudge past: show the loader, not a play/pause flicker.
    // Same for a picked song that is waiting for the network (offline, not downloaded).
    // A song that played to its end is no stall, even inside the start window (a very short file): never resume it.
    const ended = reason === 'end';
    const startStall = (state === 'paused' || state === 'stopped') && (waitingWithLoader() || (state === 'paused' && !ended && intent.shouldResumeOnPause()));
    setPlayerState({ status: startStall ? 'buffering' : state === 'stopped' ? (playerState().queue.length ? 'paused' : 'idle') : state });
    if (state === 'paused') {
      persistNow();
      if (!ended) onUnexpectedPause();
    }
  });

  callbackManager.subscribeToPlaybackProgressChange((position, totalDuration) => {
    if (videoFlag.active || remoteRoute.handlers) return;
    const now = Date.now();
    if (now - lastPos < 250) return;
    lastPos = now;
    // Spike finding: AVPlayer can report ~2x totalDuration for raw m4a; prefer the YouTube-reported length.
    const s = playerState();
    const known = s.queue[s.index]?.durationSec ?? 0;
    if (seekHoldDrops(position)) return;
    setPlayerState({ position, duration: known || totalDuration });
    curPos = position;
    if (curState === 'playing') markPlaying();
    const moved = Math.abs(position - baseline) > 0.2 || baseline < 0.3;
    if (position > 0.3 && moved && curTrack && audioFor !== curTrack) {
      audioFor = curTrack;
      onFirstAudio(curTrack);
    }
  });

  void TrackPlayer.getState()
    .then((n) => {
      curTrack = n.currentTrack?.id;
      curState = n.currentState;
    })
    .catch(() => {});
  log('bridge', 'player bridge started (headless)');
}
