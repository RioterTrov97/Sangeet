import type { PlayStatus } from './store';

/**
 * What pressing a track that may already be the current one should do. The current song never restarts from a card:
 * 'open' just shows Now Playing, 'resume' also un-pauses it, 'play' (not the current song, or nothing is loaded) starts it.
 */
export function pressAction(s: { currentId?: string; status: PlayStatus }, id: string): 'play' | 'open' | 'resume' {
  if (!s.currentId || s.currentId !== id || s.status === 'idle') return 'play';
  return s.status === 'paused' ? 'resume' : 'open';
}
