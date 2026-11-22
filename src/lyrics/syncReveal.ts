import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

/** The lyrics sync arrows are hidden until asked for: shown for SYNC_ARROWS_HOLD_MS after the hint appears or a press, then faded out. */
export const SYNC_ARROWS_HOLD_MS = 5000;
export const SYNC_ARROWS_FADE_IN_MS = 200;
export const SYNC_ARROWS_FADE_OUT_MS = 400;

/** One restartable timer: `restart()` (re)arms it, `onExpire` runs once after `ms` with no further restart. */
export function createIdleTimer(onExpire: () => void, ms: number = SYNC_ARROWS_HOLD_MS) {
  let id: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (id !== undefined) clearTimeout(id);
    id = undefined;
  };
  return {
    restart() {
      cancel();
      id = setTimeout(() => {
        id = undefined;
        onExpire();
      }, ms);
    },
    cancel,
  };
}

const listeners = new Set<() => void>();
/** Reveal the arrows of the mounted lyrics view (the TV key handler lives outside it). */
export const pingSyncArrows = () => listeners.forEach((l) => l());

/**
 * Opacity (native-driven) and a `shown` flag for the sync arrows. They show on mount (the hint just appeared), on `reveal()` and on
 * `pingSyncArrows()`, and fade out after SYNC_ARROWS_HOLD_MS without another one. No per-frame JS work: one timer, one native animation.
 */
export function useSyncReveal() {
  const [opacity] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(true); // the hint just appeared
  const timer = useRef<ReturnType<typeof createIdleTimer> | null>(null);
  const reveal = useRef(() => {});
  useEffect(() => {
    const fadeIn = () => Animated.timing(opacity, { toValue: 1, duration: SYNC_ARROWS_FADE_IN_MS, useNativeDriver: true }).start();
    const t = createIdleTimer(() => {
      setShown(false);
      Animated.timing(opacity, { toValue: 0, duration: SYNC_ARROWS_FADE_OUT_MS, useNativeDriver: true }).start();
    });
    timer.current = t;
    reveal.current = () => {
      setShown(true);
      fadeIn();
      t.restart();
    };
    reveal.current();
    const l = () => reveal.current();
    listeners.add(l);
    return () => {
      listeners.delete(l);
      t.cancel();
    };
  }, [opacity]);
  const trigger = useCallback(() => reveal.current(), []);
  return { opacity, shown, reveal: trigger };
}
