import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import type { Track } from '../youtube/models';

export type RepeatMode = 'off' | 'all' | 'one';
export type PlayStatus = 'idle' | 'playing' | 'paused' | 'buffering';

export type PlayerStoreState = {
  queue: Track[];
  index: number;
  /** Pre-shuffle order; set while shuffle is on. */
  original: Track[] | null;
  shuffle: boolean;
  repeat: RepeatMode;
  status: PlayStatus;
  /** Seconds; updated by the bridge at most ~4x/s. */
  position: number;
  duration: number;
  source?: string;
  /** Human label for `source` (e.g. album title), shown as "Next from: ...". */
  sourceName?: string;
  /** Ids added via Play next / Add to queue, shown as "Next in queue". */
  userAdded: string[];
  /** True while a radio fetch is running. */
  loadingRadio: boolean;
};

export const usePlayerStore = create<PlayerStoreState>(() => ({
  queue: [],
  index: 0,
  original: null,
  shuffle: false,
  repeat: 'off',
  status: 'idle',
  position: 0,
  duration: 0,
  source: undefined,
  sourceName: undefined,
  userAdded: [],
  loadingRadio: false,
}));

export const playerState = () => usePlayerStore.getState();
export const setPlayerState = (p: Partial<PlayerStoreState>) => usePlayerStore.setState(p);

export function useNowPlaying() {
  return usePlayerStore(
    useShallow((s) => ({
      track: s.queue[s.index] as Track | undefined,
      isPlaying: s.status === 'playing' || s.status === 'buffering',
      status: s.status,
      shuffle: s.shuffle,
      repeat: s.repeat,
    })),
  );
}

/** True once the current song has been loading for a moment: a brief buffering between songs does not flash a spinner. */
export function useLoading(delayMs = 300): boolean {
  const buffering = usePlayerStore((s) => s.status === 'buffering' && !!s.queue[s.index]);
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!buffering) return;
    const t = setTimeout(() => setLate(true), delayMs);
    return () => {
      clearTimeout(t);
      setLate(false); // buffering ended (or restarted): the next stretch waits again
    };
  }, [buffering, delayMs]);
  return buffering && late;
}

export function useProgress() {
  return usePlayerStore(useShallow((s) => ({ position: s.position, duration: s.duration || s.queue[s.index]?.durationSec || 0 })));
}

export function useQueue() {
  return usePlayerStore(useShallow((s) => ({ queue: s.queue, index: s.index })));
}
