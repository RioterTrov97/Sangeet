import type { PlayerStoreState } from '../player/store';
import { enterPosition, exitPosition } from '../video/timeline';
import { fromWire, toWire, type RemoteLayout, type RemoteMode, type ServerMsg, type TvSnapshot } from './protocol';

type TickMsg = Extract<ServerMsg, { t: 'tick' }>;

/**
 * Remote-mode reducer: how a TV message changes the phone's player store. The phone store is a mirror while a TV is
 * connected; local-only fields (original order, userAdded, loadingRadio) are cleared.
 */
export function applyTvState(prev: PlayerStoreState, snap: TvSnapshot): Partial<PlayerStoreState> {
  // Reuse the previous queue array when the TV's queue is unchanged (same ids), so subscribers do not re-render.
  const queue = sameIds(prev.queue, snap.queue) ? prev.queue : snap.queue.map(fromWire);
  return {
    queue,
    index: snap.index,
    status: snap.status,
    position: songPositionOf(snap),
    duration: songDurationOf(snap),
    shuffle: snap.shuffle,
    repeat: snap.repeat,
    original: null,
    userAdded: [],
    loadingRadio: false,
  };
}

export function applyTick(prev: PlayerStoreState, tick: Pick<TickMsg, 'position' | 'duration' | 'status' | 'songPosition' | 'songDuration'>): Partial<PlayerStoreState> {
  const position = songPositionOf(tick);
  const duration = songDurationOf(tick);
  if (prev.position === position && prev.status === tick.status && prev.duration === duration) return {};
  return { position, status: tick.status, duration: duration || prev.duration };
}

/**
 * The phone works in SONG time everywhere (scrubber, seeks, lyrics). A TV that reports it sends it explicitly; an older TV
 * only has `position` / `duration`, which are the song's anyway unless it is showing a video.
 */
export const songPositionOf = (m: { position: number; songPosition?: number }): number => (typeof m.songPosition === 'number' ? m.songPosition : m.position);
export const songDurationOf = (m: { duration: number; songDuration?: number }): number => (typeof m.songDuration === 'number' && m.songDuration > 0 ? m.songDuration : m.duration);
/** True when the TV reports song time (a seek may then be sent in song seconds with `song: true`). */
export const reportsSongTime = (m: { songPosition?: number }): boolean => typeof m.songPosition === 'number';

/** Song seconds -> the timeline the TV's player is on (the video's while a video plays). Used by the TV for `seek { song: true }`. */
export const toPlayingTime = (songSec: number, videoActive: boolean, offset: number | undefined, videoDuration?: number): number => (videoActive ? enterPosition(songSec, offset ?? 0, videoDuration) : songSec);

function sameIds(a: { id: string }[], b: { videoId: string }[]): boolean {
  return a.length === b.length && a.every((t, i) => t.id === b[i].videoId);
}

/** TV side: the snapshot pushed to phones. */
export type TvInfo = Pick<TvSnapshot, 'resolvedLayout' | 'videoId' | 'videoTier' | 'videoKind' | 'videoState' | 'lyrics' | 'quality'>;

export function buildSnapshot(s: PlayerStoreState, mode: RemoteMode, layout?: RemoteLayout, videoOffset?: number, info: TvInfo = {}): TvSnapshot {
  const cur = s.queue[s.index];
  const duration = s.duration || cur?.durationSec || 0;
  // In video mode the player's position / duration are the video's: also report the song's own time.
  const songDur = cur?.durationSec || (mode === 'video' ? Math.max(0, duration - (videoOffset ?? 0)) : duration);
  return {
    track: cur ? toWire(cur) : null,
    position: s.position,
    duration,
    songPosition: mode === 'video' ? exitPosition(s.position, videoOffset ?? 0, songDur) : s.position,
    songDuration: songDur,
    ...info,
    status: s.status,
    queue: s.queue.map(toWire),
    index: s.index,
    mode,
    ...(layout ? { layout } : {}),
    ...(mode === 'video' && videoOffset !== undefined ? { videoOffset } : {}),
    shuffle: s.shuffle,
    repeat: s.repeat,
  };
}

/**
 * Connecting pushes the phone's current song and queue to the TV and plays it, even when the phone was paused or the TV
 * is already playing something else (the phone explicitly sent a song). Only a phone with nothing selected mirrors the TV.
 */
export function shouldHandOver(local: Pick<PlayerStoreState, 'queue' | 'status'>): boolean {
  return local.queue.length > 0;
}

/** Leaving remote mode: the phone goes back to its own last local state, stopped. The TV is left alone. */
export function localAfterLeave(local: PlayerStoreState): Partial<PlayerStoreState> {
  return { queue: local.queue, index: local.index, original: local.original, shuffle: local.shuffle, repeat: local.repeat, position: local.position, duration: local.duration, source: local.source, sourceName: local.sourceName, userAdded: local.userAdded, loadingRadio: false, status: local.queue.length ? 'paused' : 'idle' };
}
