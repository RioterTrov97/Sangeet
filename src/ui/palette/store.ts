import { create } from 'zustand';
import { makeMutable, withTiming, Easing } from 'react-native-reanimated';

import { usePlayerStore } from '../../player/store';
import { getJson, setJson } from '../../util/storage';
import { whenStartupReady } from '../../util/startup';
import { STATIC_PALETTE, type Palette } from './derive';
import { cachedPalette, paletteFor } from './extract';

const MATCH_KEY = 'appearance.matchColors';

type PaletteState = { palette: Palette; matchColors: boolean };

export const usePaletteStore = create<PaletteState>(() => ({ palette: STATIC_PALETTE, matchColors: getJson<boolean>(MATCH_KEY) ?? true }));

export function setMatchColors(on: boolean): void {
  setJson(MATCH_KEY, on);
  usePaletteStore.setState({ matchColors: on });
  void applyCurrent();
}

/** Current palette, or the static green theme when "Match colours to music" is off. */
export function usePalette(): Palette {
  return usePaletteStore((s) => (s.matchColors ? s.palette : STATIC_PALETTE));
}

// UI-thread transition state: `from` -> `to`, progress 0..1 over ~600 ms. No React re-render per frame.
export const paletteFrom = makeMutable<Palette>(STATIC_PALETTE);
export const paletteTo = makeMutable<Palette>(STATIC_PALETTE);
export const paletteProgress = makeMutable(1);

function push(p: Palette): void {
  if (usePaletteStore.getState().palette === p) return;
  usePaletteStore.setState({ palette: p });
  paletteFrom.value = paletteTo.value;
  paletteTo.value = p;
  paletteProgress.value = 0;
  paletteProgress.value = withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) });
}

let currentId: string | undefined;
async function applyCurrent(): Promise<void> {
  const s = usePlayerStore.getState();
  const track = s.queue[s.index];
  if (!usePaletteStore.getState().matchColors) return push(STATIC_PALETTE);
  if (!track) return;
  currentId = track.id;
  const p = cachedPalette(track.id) ?? (await paletteFor(track));
  if (p && currentId === track.id) push(p);
  const next = s.queue[s.index + 1];
  if (next) whenStartupReady(() => void paletteFor(next)); // prefetch so the transition has no wait (TV: after startup)
}

let started = false;
/** Boot hook (plain module): keeps the global now-playing palette in step with the current track. */
export function startPaletteSync(): void {
  if (started) return;
  started = true;
  let last: string | undefined;
  usePlayerStore.subscribe((s) => {
    const id = s.queue[s.index]?.id;
    if (id === last) return;
    last = id;
    void applyCurrent();
  });
}
