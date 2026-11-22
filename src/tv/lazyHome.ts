import { useCallback, useEffect, useState } from 'react';

import { markInteractive } from '../util/startup';

/** The Home rows below the first screen (spotlight + quick picks), in the order they load. */
export const HOME_SECTIONS = ['top', 'personal', 'new', 'artists', 'moods'] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];
const FOCUS_ORDER = ['spot', 'quick', ...HOME_SECTIONS] as const;
export type HomeFocusKey = (typeof FOCUS_ORDER)[number];

/** After this long the first lazy row loads; then one more every STAGE_STEP_MS. */
export const STAGE_FIRST_MS = 2500;
export const STAGE_STEP_MS = 1200;

/** One more row. `stage` is how many lazy rows are unlocked. */
export const nextStage = (stage: number): number => Math.min(HOME_SECTIONS.length, stage + 1);

/** Focus in a section unlocks the row after it (within about one row of focus), never fewer than already unlocked. */
export function stageAfterFocus(stage: number, key: HomeFocusKey): number {
  return Math.max(stage, Math.min(HOME_SECTIONS.length, FOCUS_ORDER.indexOf(key)));
}

export const sectionUnlocked = (stage: number, key: HomeSection): boolean => HOME_SECTIONS.indexOf(key) < stage;

/**
 * Staggered loading for TV Home: nothing below the first screen mounts or fetches until the first screen is up and the JS
 * thread is idle, then one row at a time, or sooner when the user's focus gets within a row of it.
 */
export function useHomeStage(ready: boolean): { has: (k: HomeSection) => boolean; focus: (k: HomeFocusKey) => void } {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!ready) return;
    markInteractive();
    let step: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setStage((n) => {
        const m = nextStage(n);
        if (m < HOME_SECTIONS.length) step = setTimeout(tick, STAGE_STEP_MS);
        return m;
      });
    };
    step = setTimeout(tick, STAGE_FIRST_MS);
    return () => {
      alive = false;
      clearTimeout(step);
    };
  }, [ready]);
  const focus = useCallback((k: HomeFocusKey) => setStage((n) => stageAfterFocus(n, k)), []);
  const has = useCallback((k: HomeSection) => sectionUnlocked(stage, k), [stage]);
  return { has, focus };
}
