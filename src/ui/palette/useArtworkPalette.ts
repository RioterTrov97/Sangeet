import { useEffect, useState } from 'react';

import type { Artwork } from '../../youtube/models';
import type { Palette } from './derive';
import { cachedPalette, paletteForArtwork } from './extract';
import { usePaletteStore } from './store';

/** Palette of an arbitrary image (artist photo...), or undefined while loading / with "Match colours" off. */
export function useArtworkPalette(key: string | undefined, art: Artwork[] | undefined): Palette | undefined {
  const on = usePaletteStore((s) => s.matchColors);
  const [p, setP] = useState<Palette | undefined>(() => (key ? cachedPalette(key) : undefined));
  useEffect(() => {
    if (!key || !art?.length) return;
    let alive = true;
    void paletteForArtwork(key, art).then((r) => alive && setP(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, art?.length]);
  return on ? p : undefined;
}
