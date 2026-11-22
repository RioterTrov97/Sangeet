import type { Track } from '../youtube/models';
import type { RepeatMode } from './store';

/**
 * Registry the queue controller consults while the phone controls a Sangeet TV (a remote-mode session). Like
 * `videoFlag`, it keeps queue.ts free of imports from the remote layer. While `handlers` is set, every play action
 * is forwarded to the TV instead of the local native player. CarPlay uses `playLocal*` entry points that bypass it.
 */
export type RemoteHandlers = {
  playTracks: (tracks: Track[], startIndex: number, opts: { source?: string; sourceName?: string; shuffle?: boolean }) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  togglePlay: () => void;
  skipNext: () => void;
  skipPrevious: () => void;
  seekTo: (sec: number) => void;
  skipToIndex: (i: number) => void;
  setShuffle: (on: boolean) => void;
  setRepeat: (mode: RepeatMode) => void;
};
/** `release` ends the session without handing the queue back (CarPlay takes over locally). */
export const remoteRoute: { handlers?: RemoteHandlers; deviceName?: string; release?: () => void } = {};
export const isRemote = () => !!remoteRoute.handlers;
