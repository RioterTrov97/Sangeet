/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated by design */
import { useEffect } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { usePlayerStore } from '../player/store';
import { isRemote } from '../player/remoteFlag';
import { isStalled, SNAP_LOCAL_S, SNAP_REMOTE_S, stepEased } from './clockMath';

/**
 * Smooth playback clock (seconds) on the UI thread. The player store only updates ~4x/s (and in remote mode the TV
 * heartbeat ~1x/s), so every changed position is a measurement: the frame callback keeps advancing the clock by the
 * frame delta while playing and eases the small difference in over ~300 ms (stepEased), snapping only on a seek.
 * Locally the clock also holds still while "playing" with a frozen position (stream still loading). In remote mode
 * that stall guard is off: the TV's own status is authoritative and heartbeats are legitimately ~1 s apart.
 */
export function usePlaybackClock() {
  const init = usePlayerStore.getState();
  const pos = useSharedValue(init.position);
  const corr = useSharedValue(0);
  const playing = useSharedValue(init.status === 'playing');
  const measured = useSharedValue<number | null>(init.position);
  const snap = useSharedValue(SNAP_LOCAL_S);
  useEffect(() => {
    let lastPos = usePlayerStore.getState().position;
    let lastAdvanceAt = Date.now();
    const apply = (s: ReturnType<typeof usePlayerStore.getState>) => {
      const remote = isRemote();
      snap.value = remote ? SNAP_REMOTE_S : SNAP_LOCAL_S;
      if (s.position !== lastPos) {
        lastPos = s.position;
        lastAdvanceAt = Date.now();
        measured.value = s.position;
      }
      playing.value = s.status === 'playing' && (remote || !isStalled(Date.now(), lastAdvanceAt));
    };
    apply(usePlayerStore.getState());
    const unsub = usePlayerStore.subscribe(apply);
    const iv = setInterval(() => apply(usePlayerStore.getState()), 500);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, [playing, measured, snap]);
  useFrameCallback((frame) => {
    const next = stepEased({ pos: pos.value, corr: corr.value }, playing.value, frame.timeSincePreviousFrame ?? 16, measured.value, snap.value);
    measured.value = null;
    corr.value = next.corr;
    pos.value = next.pos;
  });
  return pos;
}
