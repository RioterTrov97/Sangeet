import { router } from 'expo-router';

import { playTracks, type PlayOpts } from '../player';
import { isPlayerOpen } from './playerOpen';
import type { Track } from '../youtube/models';

let lastOpen = 0;

/**
 * A user tapping one song: starts it (the list queues behind it) and opens the full player. Play / Shuffle buttons and
 * the round play button keep calling `playTracks` directly and stay on the page. Also right when controlling a TV (the
 * player shows the remote state).
 */
export function playSong(tracks: Track[], index: number, opts?: PlayOpts): void {
  void playTracks(tracks, index, opts);
  const now = Date.now();
  if (isPlayerOpen() || now - lastOpen < 800) return;
  lastOpen = now;
  router.push('/player');
}
