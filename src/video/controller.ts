import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { AppState, Platform } from 'react-native';
import { CarPlayHelper, TrackPlayer } from 'react-native-nitro-player';
import { create } from 'zustand';

import { intent } from '../player/intent';
import { prefetchVideoStreams, videoUrl } from '../player/proxy';
import { endSkipTap, onQueueEnded, playTracks, reloadAudioAt, resumeAudioAt, sinceSkipTap, skipNext, skipToIndex } from '../player/queue';
import { playerState, setPlayerState, usePlayerStore } from '../player/store';
import { backgroundPolicy, takeVideoStart, videoFlag } from '../player/videoFlag';
import { activeSwap, beginSwap, blocksAdvance, endSwap, needsRestore, restorePosition } from '../player/swapGuard';
import { log, logWarn } from '../util/log';
import { backgroundSustained } from '../util/sustain';
import type { Track } from '../youtube/models';
import { isOffline } from '../downloads/net';
import { knownVideoId, markVideoUnplayable, onVideoChosen, resolveVideoId } from './counterpart';
import { ensureOffset, noteVideoDuration, offsetSec } from './offsets';
import { audioCheck, canEnter, exitAction, extrapolateTime, nextPhase, type Phase, type PhaseEvent } from './handover';
import { enterPosition, exitPosition } from './timeline';
import { seekHoldDrops } from '../player/seekHold';
import { audioHasStarted, ENTER_TIMEOUT_MS, EXIT_TIMEOUT_MS, FADE_MS, FADE_STEPS, fadeGains, handoverExpired, loopsInPlace, nextModeAfterAdvance, SEEK_LEAD_S, shouldAcceptVideoTime, switchPosition, syncPlan } from './logic';

export type VideoState = {
  mode: 'song' | 'video';
  /** True from the toggle tap until the video has its first frame. */
  loading: boolean;
  player: VideoPlayer | null;
  videoId: string | null;
  error?: string;
};

export const useVideoStore = create<VideoState>(() => ({ mode: 'song', loading: false, player: null, videoId: null }));
const set = (p: Partial<VideoState>) => useVideoStore.setState(p);

let token = 0;
let advanceSeq = 0;
let subs: { remove: () => void }[] = [];
let kind: 'hls' | 'muxed' = 'hls';
let carPlay = false;
/** Last position handed to the store; used to ignore bogus time updates. */
let lastTime = 0;
/** When `lastTime` was reported (ms); with it the position is estimated without reading the player, whose getter blocks the JS thread on the main thread. */
let lastTimeAt = 0;
/** Position of the video now, from the last reported time (no player read). */
const videoNow = (): number => extrapolateTime(lastTime, lastTimeAt, Date.now(), playerState().status === 'playing');
let seeking = false;
/** True once the current video player has its first frame (its currentTime is meaningful). */
let videoStarted = false;
/** Track ids whose video failed to load: layouts that want video must not retry them in a loop. */
const videoFailed = new Set<string>();

/** Verifies the queue is still on the swapped track after a source swap and puts it (and the position) back if not. */
async function healSwap(): Promise<void> {
  const sw = activeSwap();
  if (!sw) return;
  const s = playerState();
  if (!needsRestore(sw, { id: s.queue[s.index]?.id, index: s.index })) return;
  const playing = s.status === 'playing' || s.status === 'buffering';
  logWarn('video', `source swap moved the queue off ${sw.id}; restoring index ${sw.index}`);
  await skipToIndex(sw.index, true);
  await resumeAudioAt(restorePosition(sw, Date.now(), playing), playing);
}
/** The video id being loaded or shown; stops a track-change hook from reloading the video that enterVideo is already loading. */
let wantedVideoId: string | null = null;

const currentTrack = () => playerState().queue[playerState().index] as Track | undefined;
/** How long entering video waits for the song <-> video offset before using 0 (the lookup keeps running and is cached). */
const OFFSET_WAIT_MS = 3000;
/** The song -> video offset of the track on screen against the video being shown (0 when not known). */
const nowOffset = (): number => {
  const t = currentTrack();
  return t ? (offsetSec(t.id, useVideoStore.getState().videoId ?? wantedVideoId) ?? 0) : 0;
};
export const isCarPlayConnected = () => carPlay;

/** Detaches and stops the video player. `releaseAfterMs` defers the (expensive) release so it does not run in the middle of a screen change. */
function teardownPlayer(releaseAfterMs = 0) {
  subs.forEach((s) => s.remove());
  subs = [];
  const p = useVideoStore.getState().player;
  if (p) {
    try {
      p.pause();
    } catch {}
    const release = () => {
      try {
        p.release();
      } catch {}
    };
    if (releaseAfterMs > 0) setTimeout(release, releaseAfterMs);
    else release();
  }
}

function listen(p: VideoPlayer, my: number, startAt: number, track: Track, autoplay: boolean, alreadyStarted = false) {
  let started = alreadyStarted;
  videoStarted = alreadyStarted;
  subs.push(
    p.addListener('statusChange', ({ status, error }) => {
      if (my !== token) return;
      log('video', `status=${status}${error ? ` error=${error.message}` : ''}`);
      if (status === 'readyToPlay' && !started) {
        started = true;
        videoStarted = true;
        if (sinceSkipTap() >= 0) log('video', `next: video ready +${sinceSkipTap()} ms`);
        noteVideoDuration(useVideoStore.getState().videoId ?? '', p.duration);
        if (startAt > 0.5) p.currentTime = startAt;
        if (autoplay) p.play();
        set({ loading: false });
        setPlayerState({ status: autoplay ? 'playing' : 'paused' });
        void healSwap();
        scheduleNextPrefetch();
      } else if (status === 'error') {
        if (kind === 'hls') {
          logWarn('video', 'adaptive (HLS/DASH) failed, falling back to muxed itag 18');
          kind = 'muxed';
          p.replaceAsync({ uri: videoUrl(useVideoStore.getState().videoId!, 'muxed'), contentType: 'progressive' }).catch(() => {});
        } else {
          logWarn('video', `muxed failed too, returning to song${isOffline() ? ' (offline: not marking the video bad)' : ''}`);
          // The next tier-A candidate (if any) is used the next time video is wanted; without one the song has no video.
          // Offline says nothing about the video, so it is not marked.
          const bad = isOffline() ? null : useVideoStore.getState().videoId;
          const next = bad ? markVideoUnplayable(track.id, bad) : null;
          void exitVideo({ error: 'Video could not be played' }).then(() => {
            if (next) videoFailed.delete(track.id);
          });
        }
      }
    }),
    p.addListener('timeUpdate', ({ currentTime }) => {
      if (my !== token || !started) return;
      if (seekHoldDrops(currentTime)) return;
      if (!shouldAcceptVideoTime(lastTime, currentTime, seeking)) return;
      seeking = false;
      lastTime = currentTime;
      lastTimeAt = Date.now();
      setPlayerState({ position: currentTime, duration: p.duration > 0 ? p.duration : (currentTrack()?.durationSec ?? 0) });
    }),
    p.addListener('playingChange', ({ isPlaying }) => {
      if (my !== token) return;
      if (isPlaying && sinceSkipTap() >= 0) {
        log('video', `next: video playing +${sinceSkipTap()} ms`);
        endSkipTap();
      }
      setPlayerState({ status: isPlaying ? 'playing' : started ? 'paused' : 'buffering' });
    }),
    p.addListener('playToEnd', () => {
      if (my !== token || !started) return; // Android fires playToEnd while a replaced source is still loading
      if (blocksAdvance()) return void log('video', 'ignored playToEnd during source swap');
      void onEnded();
    }),
  );
}

/**
 * Loads `videoId` into the video mode player. `reuse`: the player on screen is kept and given the new source (no
 * release / create of the decoder, the VideoView stays mounted and keeps its last frame until the new one draws),
 * which is what a track change inside video mode wants.
 */
async function loadVideo(track: Track, videoId: string, startAt: number, autoplay = true, reuse = false): Promise<void> {
  wantedVideoId = videoId;
  const my = ++token;
  const old = useVideoStore.getState().player;
  const keep = reuse && !!old && videoFlag.active;
  if (keep) {
    subs.forEach((s) => s.remove());
    subs = [];
    try {
      old.pause();
    } catch {}
  } else teardownPlayer();
  kind = 'hls';
  lastTime = startAt;
  lastTimeAt = 0;
  let p: VideoPlayer;
  if (keep) {
    p = old;
    set({ videoId, loading: true, error: undefined });
  } else {
    p = createVideoPlayer(null);
    p.timeUpdateEventInterval = 0.25;
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
    p.keepScreenOnWhilePlaying = true;
    p.allowsExternalPlayback = true; // video can be sent to an AirPlay TV via the route picker (default, set explicitly)
    set({ player: p, videoId, loading: true, error: undefined });
  }
  setPlayerState({ status: 'buffering', position: startAt });
  listen(p, my, startAt, track, autoplay);
  try {
    await p.replaceAsync(Platform.OS === 'ios' ? { uri: videoUrl(videoId, 'hls') } : { uri: videoUrl(videoId, 'hls'), contentType: 'dash' });
    if (my === token && sinceSkipTap() >= 0) log('video', `next: source loaded +${sinceSkipTap()} ms`);
  } catch (e) {
    if (my === token) {
      logWarn('video', 'replaceAsync failed', e instanceof Error ? e.message : e);
      void exitVideo({ error: 'Video could not be loaded' });
    }
  }
}

/** While a video plays, resolves the NEXT song's video id and streams so Next does not wait for the chain or the extractor. */
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleNextPrefetch(): void {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    if (!videoFlag.active || carPlay) return;
    const s = playerState();
    const next = s.queue[s.index + 1] ?? (s.repeat === 'all' ? s.queue[0] : undefined);
    if (!next || next.id === s.queue[s.index]?.id) return;
    try {
      const id = await resolveVideoId(next);
      if (id && videoFlag.active) prefetchVideoStreams(id);
    } catch {}
  }, 2500); // after the current video has started, so the two do not compete
}

// ---- make-before-break handover (no audible gap) ----
//
// Entering video: TrackPlayer keeps playing while a muted video player loads, starts and is re-synced to the audio's
// live position; only then do the two cross-fade (video up, audio down) and the audio is paused. If the video fails or
// takes too long nothing audible happens. Leaving video is the mirror image: the audio starts (silent) at the video's
// live position, and once it really plays the video fades out and is torn down. Paused music swaps silently.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isAndroid = Platform.OS === 'android';
/** Bumped to cancel an enterVideo that is still waiting for its muted video (layout changed, screen left, track changed). */
let pendingEnter = 0;
let pendingPlayer: VideoPlayer | null = null;
let pendingCancel: (() => void) | null = null;
/** One state machine for enter/exit so they can never run on top of each other (see handover.ts). */
let phase: Phase = 'idle';
let enterRun: Promise<unknown> | null = null;
const move = (e: PhaseEvent) => void (phase = nextPhase(phase, e));

function dropPending(): void {
  pendingEnter++;
  pendingCancel?.();
  pendingCancel = null;
  if (pendingPlayer) {
    try {
      pendingPlayer.pause();
      pendingPlayer.release();
    } catch {}
    pendingPlayer = null;
  }
}

async function audioNow(): Promise<{ pos: number; state: string }> {
  const n = await TrackPlayer.getState();
  return { pos: n.currentPosition, state: n.currentState };
}
const setAudioVolume = (v: number) => TrackPlayer.setVolume(v).catch(() => {});

/** Cross-fades `audioIn`/`videoIn`: the audio player's gain goes to `audioTo` (0 or 100), the video's the other way. */
async function crossfade(p: VideoPlayer, audioTo: 0 | 100, cancelled: () => boolean = () => false): Promise<void> {
  for (let i = 1; i <= FADE_STEPS; i++) {
    if (cancelled()) return;
    const g = fadeGains(i, FADE_STEPS);
    const audioGain = audioTo === 0 ? g.out : g.in; // audio ends at `audioTo`
    const videoGain = audioTo === 0 ? g.in : g.out;
    void setAudioVolume(Math.round(audioGain * 100));
    try {
      p.volume = videoGain;
    } catch {}
    await sleep(FADE_MS / FADE_STEPS);
  }
}

/** Creates the video player muted, plays it at the audio's position and resolves once it is really playing (null on failure / timeout). */
function prepareMuted(videoId: string, my: number, startFor: (audioPos: number) => Promise<number>): Promise<VideoPlayer | null> {
  return new Promise((resolve) => {
    const p = createVideoPlayer(null);
    p.timeUpdateEventInterval = 0.25;
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
    p.keepScreenOnWhilePlaying = true;
    p.allowsExternalPlayback = true;
    p.muted = true;
    p.volume = 0;
    if (isAndroid) p.audioMixingMode = 'mixWithOthers'; // an audible video must not take audio focus from the song during the handover
    pendingPlayer = p;
    kind = 'hls';
    let done = false;
    let ready = false;
    const subs2: { remove: () => void }[] = [];
    const timer = setTimeout(() => {
      logWarn('video', `prepare timed out after ${ENTER_TIMEOUT_MS} ms`);
      finish(false);
    }, ENTER_TIMEOUT_MS);
    function finish(ok: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subs2.forEach((s) => s.remove());
      pendingCancel = null;
      if (!ok && pendingPlayer === p) {
        try {
          p.pause();
          p.release();
        } catch {}
        pendingPlayer = null;
      }
      resolve(ok ? p : null);
    }
    pendingCancel = () => finish(false);
    subs2.push(
      p.addListener('statusChange', ({ status, error }) => {
        if (done) return;
        if (my !== pendingEnter) return finish(false);
        log('video', `prep status=${status}${error ? ` error=${error.message}` : ''}`);
        if (status === 'readyToPlay' && !ready) {
          ready = true;
          const go = (pos: number) => {
            if (done) return;
            if (pos > 0.5) p.currentTime = pos;
            p.play();
          };
          audioNow().then((a) => startFor(a.pos + SEEK_LEAD_S).then(go), () => go(0));
        } else if (status === 'error') {
          if (kind === 'hls') {
            logWarn('video', 'adaptive failed, falling back to muxed itag 18');
            kind = 'muxed';
            ready = false;
            p.replaceAsync({ uri: videoUrl(videoId, 'muxed'), contentType: 'progressive' }).catch(() => finish(false));
          } else finish(false);
        }
      }),
      p.addListener('playingChange', ({ isPlaying }) => {
        if (isPlaying && ready && my === pendingEnter) finish(true);
      }),
    );
    p.replaceAsync(Platform.OS === 'ios' ? { uri: videoUrl(videoId, 'hls') } : { uri: videoUrl(videoId, 'hls'), contentType: 'dash' }).catch((e) => {
      logWarn('video', 'prepare replaceAsync failed', e instanceof Error ? e.message : e);
      finish(false);
    });
  });
}

/** Song -> Video at the current position. No-op without a video, or while another enter/exit is running. */
export function enterVideo(track: Track): Promise<boolean> {
  if (!canEnter(phase) || videoFlag.active || carPlay || videoFailed.has(track.id) || AppState.currentState !== 'active') return Promise.resolve(false);
  move('enter');
  const run: Promise<boolean> = enterInner(track)
    .catch((e) => {
      logWarn('video', 'enter failed', e instanceof Error ? e.message : e);
      return false;
    })
    .finally(() => {
      move(videoFlag.active ? 'entered' : 'enter-aborted');
      if (enterRun === run) enterRun = null;
    });
  enterRun = run;
  return run;
}

/**
 * "Watch video" from a menu: always ends in Video mode when a video resolves. Starts the song when it is not the
 * current track, forgets an earlier failure for it (a failed attempt must not make the item dead), and retries once
 * when an enter/exit is still running. Timing never blocks it: an unknown song/video offset starts at offset 0 and the
 * lyrics carry "May be out of sync"; a different cut stretches them over the video (see lyricsStretchFor).
 */
export async function watchVideo(track: Track): Promise<boolean> {
  videoFailed.delete(track.id);
  if (!videoFlag.active && !carPlay) set({ loading: true, error: undefined }); // the Video tab shows at once; the picture follows
  const cur = () => playerState().queue[playerState().index];
  if (cur()?.id !== track.id) {
    await playTracks([track], 0);
    for (let i = 0; i < 20 && cur()?.id !== track.id; i++) await sleep(100);
  }
  if (videoFlag.active) return true;
  try {
    for (let i = 0; i < 2; i++) {
      if (enterRun) await enterRun.catch(() => {});
      if (videoFlag.active) return true;
      if (await enterVideo(track)) return true;
      if (phase === 'idle' || carPlay) break;
      await sleep(500);
    }
    if (!useVideoStore.getState().error && !carPlay) {
      logWarn('video', `watch ${track.id} gave up: phase=${phase} active=${videoFlag.active} failedBefore=${videoFailed.has(track.id)} app=${AppState.currentState}`);
      set({ error: 'Video could not be played' });
    }
    return false;
  } finally {
    // A failed or cancelled enter must not leave the Video tab showing a spinner.
    if (!videoFlag.active && useVideoStore.getState().mode !== 'video') set({ loading: false });
  }
}

async function enterInner(track: Track): Promise<boolean> {
  dropPending();
  const my = pendingEnter;
  set({ loading: true, error: undefined });
  const videoId = await resolveVideoId(track);
  if (my !== pendingEnter) return false;
  if (!videoId) {
    set({ loading: false, error: 'No video for this song' });
    return false;
  }
  wantedVideoId = videoId;
  const s = playerState();
  const wasPlaying = s.status === 'playing' || s.status === 'buffering';
  if (!wasPlaying) return enterPaused(track, videoId, my);
  log('video', `enter ${track.id} -> video ${videoId} (make-before-break)`);
  const t0 = Date.now();
  // The song -> video offset is looked up while the muted video loads; the video starts at song position + offset.
  const offsetWait = Promise.race([ensureOffset(track, videoId), sleep(OFFSET_WAIT_MS)]);
  const p = await prepareMuted(videoId, my, async (songPos) => {
    await offsetWait;
    return enterPosition(songPos, offsetSec(track.id, videoId) ?? 0);
  });
  if (my !== pendingEnter) return false; // cancelled; dropPending already released the player
  const fail = (why: string) => {
    logWarn('video', `enter aborted: ${why}; staying on audio`);
    if (pendingPlayer === p) dropPending();
    if (!isOffline()) videoFailed.add(track.id);
    set({ loading: false, error: 'Video could not be played' });
    return false;
  };
  if (!p) return fail('video not ready');
  const cur0 = playerState();
  if (cur0.queue[cur0.index]?.id !== track.id) {
    dropPending();
    set({ loading: false });
    return false;
  }
  // Re-sync to the audio's live position (the video started a little behind or ahead of it).
  let a = await audioNow();
  await offsetWait;
  if (my !== pendingEnter) return false; // cancelled while waiting; dropPending already released the player
  const off = offsetSec(track.id, videoId) ?? 0;
  const plan = syncPlan(p.currentTime, enterPosition(a.pos, off, p.duration));
  if (plan.seek) {
    log('video', `resync video ${p.currentTime.toFixed(2)} -> ${plan.to.toFixed(2)} (audio ${a.pos.toFixed(2)}, offset ${off.toFixed(2)})`);
    p.currentTime = plan.to;
    await sleep(450);
    if (my !== pendingEnter) return false;
    a = await audioNow();
  }
  if (my !== pendingEnter) return false;
  if (handoverExpired(t0, Date.now(), ENTER_TIMEOUT_MS + 3000)) return fail('too slow');
  const audible = a.state === 'playing' || a.state === 'buffering'; // the user may have paused while the video loaded
  const at = switchPosition(a.pos, s.duration || track.durationSec);
  const idx = playerState().index;
  beginSwap(track.id, idx, at);
  intent.cancel('user'); // the pause below is ours, not an interruption to undo
  videoFlag.active = true;
  videoFlag.hooks = hooks;
  pendingPlayer = null;
  const my2 = ++token;
  teardownPlayer();
  lastTime = p.currentTime;
  lastTimeAt = Date.now();
  set({ player: p, videoId, mode: 'video', loading: false, error: undefined });
  listen(p, my2, at, track, true, true);
  if (!audible) {
    p.pause();
    p.currentTime = enterPosition(at, off, p.duration);
  }
  p.volume = 0;
  p.muted = false;
  const cancelled = () => my !== pendingEnter;
  if (audible) await crossfade(p, 0, cancelled);
  else p.volume = 1;
  // A Back during the crossfade: leave the audio playing (the exit that is waiting for us resumes it at the right place).
  if (cancelled()) {
    log('video', 'enter cancelled during crossfade');
    if (isAndroid) p.audioMixingMode = 'auto';
    return true;
  }
  await TrackPlayer.pause().catch(() => {});
  await setAudioVolume(100);
  if (isAndroid) p.audioMixingMode = 'auto';
  setPlayerState({ status: audible ? 'playing' : 'paused', position: p.currentTime });
  log('video', `handover to video done at ${p.currentTime.toFixed(2)}s (audio was ${a.pos.toFixed(2)}s, offset ${off.toFixed(2)}, ${Date.now() - t0} ms)`);
  setTimeout(() => void healSwap().finally(() => setTimeout(endSwap, 1500)), 1500);
  scheduleNextPrefetch();
  return true;
}

/** Music was paused: swap to the video silently (loads paused at the song's position). */
async function enterPaused(track: Track, videoId: string, my: number): Promise<boolean> {
  const s = playerState();
  const at = switchPosition(s.position, s.duration || track.durationSec);
  beginSwap(track.id, s.index, at);
  await Promise.race([ensureOffset(track, videoId), sleep(OFFSET_WAIT_MS)]);
  const off = offsetSec(track.id, videoId) ?? 0;
  const videoAt = enterPosition(at, off);
  log('video', `enter ${track.id} -> video ${videoId} at ${videoAt.toFixed(1)}s (song ${at.toFixed(1)}s, offset ${off.toFixed(2)}, paused)`);
  if (my !== pendingEnter) return false;
  intent.cancel('user');
  videoFlag.active = true;
  videoFlag.hooks = hooks;
  await TrackPlayer.pause().catch(() => {});
  await TrackPlayer.seek(at).catch(() => {});
  set({ mode: 'video' });
  await loadVideo(track, videoId, videoAt, false);
  return true;
}

/** After handing back to audio: once it should have settled, check the audio item really plays from the right place and repair it (seek, or reload the item when it is idle / errored). */
function verifyAudio(startAt: number, t0: number): void {
  const token = intent.token();
  setTimeout(async () => {
    if (intent.cancelledSince(token) || videoFlag.active) return; // the user paused, or video came back
    const a = await audioNow().catch(() => undefined);
    if (!a || intent.cancelledSince(token)) return;
    const expected = startAt + (Date.now() - t0) / 1000;
    const verdict = audioCheck(a.state, a.pos, expected);
    if (verdict === 'ok') return;
    logWarn('video', `audio after handover is ${a.state} at ${a.pos.toFixed(2)}s, expected ${expected.toFixed(2)}s: ${verdict}`);
    if (verdict === 'seek') await TrackPlayer.seek(expected + 0.3).catch(() => {});
    else await reloadAudioAt(expected + 0.5, true);
  }, 1800);
}

/** Clears video mode (the video player is detached and paused at once, released a little later). */
function leaveVideoMode(releaseAfterMs: number) {
  token++;
  teardownPlayer(releaseAfterMs);
  videoStarted = false;
  videoFlag.active = false;
  videoFlag.hooks = undefined;
  wantedVideoId = null;
}

/**
 * Video -> audio when the video is no longer on screen (Now Playing was left): nothing visual to keep in sync, so no
 * crossfade and no polling. The video stops at once, the audio is seeked and started once, and the video player is
 * released later. The position comes from the last reported video time, never from a player read.
 */
async function exitFast(wasPlaying: boolean): Promise<void> {
  const t0 = Date.now();
  const songDur = currentTrack()?.durationSec;
  const off = nowOffset();
  const vNow = videoNow();
  const startAt = exitPosition(vNow + (wasPlaying ? SEEK_LEAD_S : 0), off, songDur);
  const s0 = playerState();
  beginSwap(s0.queue[s0.index]?.id ?? '', s0.index, startAt);
  log('video', `exit (off-screen) from video ${vNow.toFixed(2)}s to song ${startAt.toFixed(2)}s (offset ${off.toFixed(2)}, playing=${wasPlaying})`);
  const st = useVideoStore.getState();
  try {
    st.player?.pause();
  } catch {}
  await TrackPlayer.seek(startAt).catch(() => {});
  leaveVideoMode(400);
  void setAudioVolume(100);
  set({ mode: 'song', player: null, videoId: null, loading: false });
  setPlayerState({ position: startAt, status: wasPlaying ? 'playing' : 'paused', ...(songDur ? { duration: songDur } : {}) });
  if (wasPlaying) {
    intent.request();
    await TrackPlayer.play().catch(() => {});
    verifyAudio(startAt, t0);
  }
  log('video', `handover to audio done at ${startAt.toFixed(2)}s (${Date.now() - t0} ms)`);
  setTimeout(() => void healSwap().finally(() => setTimeout(endSwap, 1500)), 1500);
}

/** Video -> audio with the video still on screen (layout change): starts the audio (silent) at the video's live position, then fades over once it really plays. */
async function exitSmooth(p: VideoPlayer): Promise<boolean> {
  const t0 = Date.now();
  if (isAndroid) p.audioMixingMode = 'mixWithOthers'; // the audio player's focus request must not pause the video
  const songDur = currentTrack()?.durationSec;
  const off = nowOffset();
  const startAt = exitPosition(videoNow() + SEEK_LEAD_S, off, songDur);
  const s0 = playerState();
  beginSwap(s0.queue[s0.index]?.id ?? '', s0.index, startAt);
  log('video', `exit (make-before-break) from video ${videoNow().toFixed(2)}s to song ${startAt.toFixed(2)}s (offset ${off.toFixed(2)})`);
  await setAudioVolume(0);
  await TrackPlayer.seek(startAt).catch(() => {});
  intent.request();
  await TrackPlayer.play().catch(() => {});
  let started = false;
  let dead = false;
  while (!handoverExpired(t0, Date.now(), EXIT_TIMEOUT_MS)) {
    await sleep(100);
    const a = await audioNow().catch(() => undefined);
    if (a && audioHasStarted(a.state, a.pos, startAt)) {
      started = true;
      break;
    }
    // The paused item can come back errored (stale stream): stop waiting and reload it below.
    if (a && a.state === 'stopped' && Date.now() - t0 > 800) {
      dead = true;
      break;
    }
  }
  if (!started) logWarn('video', dead ? 'audio item is stopped after resume; reloading it' : `audio did not report playing within ${EXIT_TIMEOUT_MS} ms; handing over anyway`);
  const a = await audioNow().catch(() => undefined);
  if (a && started) {
    const plan = syncPlan(a.pos, exitPosition(videoNow(), off, songDur));
    if (plan.seek) {
      log('video', `resync audio ${a.pos.toFixed(2)} -> ${plan.to.toFixed(2)} (video ${videoNow().toFixed(2)})`);
      await TrackPlayer.seek(plan.to).catch(() => {});
      await sleep(250);
    }
  }
  await crossfade(p, 100);
  const at = exitPosition(videoNow(), off, songDur);
  leaveVideoMode(0);
  await setAudioVolume(100);
  set({ mode: 'song', player: null, videoId: null, loading: false });
  setPlayerState({ position: at, status: 'playing', ...(songDur ? { duration: songDur } : {}) });
  if (!started) void (dead ? reloadAudioAt(at, true) : resumeAudioAt(at, true));
  else verifyAudio(at, Date.now());
  log('video', `handover to audio done at ${at.toFixed(2)}s (${Date.now() - t0} ms)`);
  setTimeout(() => void healSwap().finally(() => setTimeout(endSwap, 1500)), 1500);
  return true;
}

/**
 * Video -> Song, resuming audio at the video's position. `offscreen`: the video view is gone or going (Now Playing is
 * being left), so skip the crossfade and hand over at once. An exit that arrives while an enter is still running
 * cancels it and waits for it to unwind first.
 */
export function exitVideo(opts: { error?: string; play?: boolean; at?: number; offscreen?: boolean } = {}): Promise<void> {
  const run = exitVideoRun(opts);
  exitRun = run;
  void run.catch(() => {}).finally(() => {
    if (exitRun === run) exitRun = null;
  });
  return run;
}
let exitRun: Promise<void> | null = null;

/**
 * The player is being closed: stop the video (or a video still loading) and leave video mode WITHOUT handing back to the
 * audio, which the caller is about to pause and clear. Waits for an exit already under way first, so its late
 * "start the audio" cannot land after the close.
 */
export async function stopVideo(): Promise<void> {
  await exitRun?.catch(() => {});
  if (phase === 'entering' || useVideoStore.getState().loading) {
    dropPending();
    await enterRun?.catch(() => {});
  }
  if (videoFlag.active) {
    log('video', 'stopped (player closed)');
    leaveVideoMode(0);
  }
  set({ mode: 'song', player: null, videoId: null, loading: false, error: undefined });
}

async function exitVideoRun(opts: { error?: string; play?: boolean; at?: number; offscreen?: boolean }): Promise<void> {
  const action = exitAction(phase);
  if (action === 'cancel-then-exit') {
    dropPending();
    if (!videoFlag.active) {
      set({ loading: false });
      log('video', 'pending enter cancelled');
    }
    await enterRun?.catch(() => {});
  }
  if (!videoFlag.active) {
    // Not in video: a load that was still waiting for its muted video is cancelled, the song just keeps playing.
    if (action === 'ignore' && phase === 'idle' && useVideoStore.getState().loading) {
      dropPending();
      set({ loading: false });
      log('video', 'pending enter cancelled');
    }
    return;
  }
  if (phase === 'exiting') return;
  if (phase === 'entering') return; // another enter started meanwhile; the next exit request will handle it
  phase = 'exiting';
  try {
    const st = useVideoStore.getState();
    const p = st.player;
    const wasPlaying = opts.play ?? (playerState().status === 'playing' || playerState().status === 'buffering');
    const plain = !opts.error && opts.at === undefined;
    if (p && videoStarted && plain && opts.offscreen) {
      await exitFast(wasPlaying);
      return;
    }
    if (p && videoStarted && wasPlaying && plain && AppState.currentState === 'active') {
      try {
        if (await exitSmooth(p)) return;
      } catch (e) {
        logWarn('video', 'smooth exit failed, falling back', e instanceof Error ? e.message : e);
      }
    }
    // Before the first frame there is no meaningful time: use the position we were loading at instead.
    const cur = videoStarted ? videoNow() : lastTime || playerState().position;
    const failedTrack = currentTrack();
    const at = opts.at ?? exitPosition(cur, nowOffset(), failedTrack?.durationSec);
    if (opts.error && failedTrack && !isOffline()) videoFailed.add(failedTrack.id); // offline: try again once back online
    const s0 = playerState();
    beginSwap(s0.queue[s0.index]?.id ?? '', s0.index, at);
    log('video', `exit at ${at.toFixed(1)}s (wasPlaying=${wasPlaying})`);
    leaveVideoMode(opts.offscreen ? 400 : 0);
    void setAudioVolume(100);
    set({ mode: 'song', player: null, videoId: null, loading: false, error: opts.error });
    setPlayerState({ position: at, status: wasPlaying ? 'buffering' : 'paused' });
    await resumeAudioAt(at, wasPlaying);
    if (wasPlaying) verifyAudio(at, Date.now());
    setTimeout(() => void healSwap().finally(() => setTimeout(endSwap, 1500)), 1500);
  } finally {
    phase = 'idle';
  }
}

function videoSeek(sec: number) {
  const p = useVideoStore.getState().player;
  if (!p) return;
  seeking = true;
  p.currentTime = sec;
  lastTime = sec;
  lastTimeAt = Date.now();
  setPlayerState({ position: sec });
}

function videoPlay() {
  const p = useVideoStore.getState().player;
  if (p && !p.playing) p.play();
}

function videoToggle() {
  const p = useVideoStore.getState().player;
  if (!p) return;
  if (p.playing) p.pause();
  else p.play();
}

/**
 * The song -> video offset probe downloads and parses ~100 KB of the audio in two dozen requests; started at the moment of a
 * Next it competes with the new video's first load on the Streamer (about 2 s of full CPU). It runs a few seconds later instead
 * (the lyrics show "may be out of sync" until it is decided, as before).
 */
const OFFSET_DEFER_MS = 4000;
function deferOffset(track: Track, videoId: string): void {
  setTimeout(() => {
    if (videoFlag.active && useVideoStore.getState().videoId === videoId) void ensureOffset(track, videoId);
  }, OFFSET_DEFER_MS);
}

/**
 * Next / skip-to pressed in video mode. The native audio player takes 0.2-0.3 s to report the change and the UI thread is busy
 * right after it, so the loading state (artwork instead of the old frame) shows and the target's video starts loading now,
 * when its id is already known (prefetched). onTrackChanged then finds that video loading and leaves it alone.
 */
function onSkipping(target: Track | undefined): void {
  if (!videoFlag.active || !target || carPlay) return;
  set({ loading: true });
  const id = knownVideoId(target);
  if (!id || id === wantedVideoId) return;
  log('video', `next: loading ${id} at the tap +${sinceSkipTap()} ms`);
  deferOffset(target, id);
  void loadVideo(target, id, 0, true, true);
}

/** Queue advanced while in video mode: stay in video if the new track has one, else drop to the song. */
const hooks = { seek: videoSeek, toggle: videoToggle, trackChanged: onTrackChanged, play: videoPlay, skipping: onSkipping };

async function onTrackChanged(id: string): Promise<void> {
  const track = playerState().queue.find((t) => t.id === id);
  if (!track || !videoFlag.active) return;
  const my = ++advanceSeq;
  if (sinceSkipTap() >= 0) log('video', `next: native change seen +${sinceSkipTap()} ms after the tap`);
  set({ loading: true });
  const action = nextModeAfterAdvance(await resolveVideoId(track));
  if (sinceSkipTap() >= 0) log('video', `next: video id resolved +${sinceSkipTap()} ms`);
  if (my !== advanceSeq || !videoFlag.active) return;
  if (action.kind === 'video') {
    if (action.videoId === wantedVideoId && useVideoStore.getState().loading && !videoFlag.startAt) return; // enterVideo is already loading it
    const at = await linkStart(track, action.videoId);
    if (my !== advanceSeq || !videoFlag.active) return;
    log('video', `advance -> video ${action.videoId}${at ? ` at ${at.toFixed(1)}s` : ''}`);
    deferOffset(track, action.videoId);
    await loadVideo(track, action.videoId, at, true, true);
  } else {
    log('video', 'advance: no video for next track, falling back to song');
    await exitVideo({ play: true, at: 0, error: 'No video for this song' });
  }
}

/**
 * Where the video of a newly started track begins: 0, or the start a link asked for (`t=`, in song time). When the
 * video is the song's own id the time is the video's; another video is placed through the song's offset in it.
 */
async function linkStart(track: Track, videoId: string): Promise<number> {
  const sec = takeVideoStart(track.id);
  if (!sec) return 0;
  if (videoId === track.id) return sec;
  await Promise.race([ensureOffset(track, videoId), sleep(OFFSET_WAIT_MS)]);
  return enterPosition(sec, offsetSec(track.id, videoId) ?? 0);
}

/** The picker changed the video of the track on screen while video is showing: play the chosen one from the same moment, or leave video when there is none. */
async function onChosen(songId: string, videoId: string | null): Promise<void> {
  videoFailed.delete(songId);
  const track = currentTrack();
  if (!track || track.id !== songId || !videoFlag.active || phase !== 'video') return;
  if (videoId === useVideoStore.getState().videoId) return;
  if (!videoId) return void (await exitVideo({ play: playerState().status === 'playing', error: 'No video for this song' }));
  const songPos = exitPosition(videoNow(), nowOffset(), track.durationSec);
  const wasPlaying = playerState().status === 'playing' || playerState().status === 'buffering';
  await Promise.race([ensureOffset(track, videoId), sleep(OFFSET_WAIT_MS)]);
  if (!videoFlag.active || currentTrack()?.id !== songId) return;
  const startAt = enterPosition(songPos, offsetSec(songId, videoId) ?? 0);
  log('video', `picker -> video ${videoId} at ${startAt.toFixed(1)}s`);
  await loadVideo(track, videoId, startAt, wasPlaying);
}

/**
 * The video restarts from where the song starts in it (its offset), not from 0, and the store follows at once. The
 * backward jump must be marked as a seek, or the time guard (shouldAcceptVideoTime) drops every update until the
 * restarted video catches up with the old position and the progress bar, elapsed time and lyrics stay at the end.
 */
function restartVideo(p: VideoPlayer): void {
  const at = enterPosition(0, nowOffset(), p.duration);
  log('video', `repeat: restart video at ${at.toFixed(2)}s`);
  seeking = true;
  p.currentTime = at;
  lastTime = at;
  lastTimeAt = Date.now();
  setPlayerState({ position: at, status: 'playing' });
  p.play();
}

async function onEnded(): Promise<void> {
  const s = playerState();
  const p = useVideoStore.getState().player;
  if (p && loopsInPlace(s.repeat, s.queue.length)) return restartVideo(p);
  const hasNext = s.index + 1 < s.queue.length || s.repeat === 'all';
  if (!hasNext) {
    setPlayerState({ status: 'paused' });
    onQueueEnded(); // related songs are fetched and the first one plays (endless queue)
    return;
  }
  void skipNext();
}

let started = false;
let activePlaying = false;
/** Registers background and CarPlay handoffs. Call once at app start. */
export function startVideoController(): void {
  if (started) return;
  started = true;
  onVideoChosen((songId, videoId) => void onChosen(songId, videoId));
  // A momentary onPause (an intent delivered to the activity, an overlay) is not "background": react only when it lasts.
  const onBackground = () => {
    if (!videoFlag.active) return;
    // The video player has already paused itself by now, so use the status from while we were in the foreground.
    const play = activePlaying && backgroundPolicy.keepPlaying();
    log('video', `app backgrounded -> handing back to audio (play=${play})`);
    void exitVideo({ play });
  };
  const sustained = backgroundSustained(onBackground);
  AppState.addEventListener('change', (st) => {
    if (!Platform.isTV) return void (st === 'background' && onBackground()); // phone: immediate, as before
    sustained(st);
    // Back within the debounce: the video paused itself on onPause, so resume it if it was playing.
    if (st === 'active' && videoFlag.active && activePlaying && phase === 'video') videoPlay();
  });
  usePlayerStore.subscribe((s) => {
    if (AppState.currentState === 'active') activePlaying = s.status === 'playing' || s.status === 'buffering';
  });
  if (Platform.OS !== 'ios') return; // CarPlay only
  CarPlayHelper.onConnectionChange((connected) => {
    carPlay = connected;
    if (connected && videoFlag.active) void exitVideo();
  });
  carPlay = CarPlayHelper.isConnected();
}
