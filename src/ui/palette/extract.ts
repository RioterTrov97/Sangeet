import { getColors } from 'react-native-image-colors';

import { getJson, setJson } from '../../util/storage';
import { pickArtwork } from '../../youtube/mappers/common';
import type { Track } from '../../youtube/models';
import { derivePalette, type Palette } from './derive';

/** On-device artwork for a track id (set at boot by the downloads layer, which this module must not import). */
let savedArt: (id: string) => string | undefined = () => undefined;
export function setSavedArtwork(fn: (id: string) => string | undefined): void {
  savedArt = fn;
}

const KEY = (id: string) => `palette.v4.${id}`;
const mem = new Map<string, Palette>();
const inflight = new Map<string, Promise<Palette | undefined>>();

/** Cached palette for a track (memory, then MMKV), or undefined. */
export function cachedPalette(videoId: string): Palette | undefined {
  return mem.get(videoId) ?? (() => {
    const p = getJson<Palette>(KEY(videoId));
    if (p) mem.set(videoId, p);
    return p;
  })();
}

/** Extracts + caches the palette for a track's artwork. Never throws; resolves undefined when there is no art. */
export const paletteFor = (track: Pick<Track, 'id' | 'artwork'>): Promise<Palette | undefined> => paletteForArtwork(track.id, track.artwork);

/** Same, keyed by any id (e.g. `artist:<id>`) so non-track artwork gets a palette too. */
export function paletteForArtwork(key: string, artwork: Track['artwork']): Promise<Palette | undefined> {
  const track = { id: key, artwork };
  const hit = cachedPalette(track.id);
  if (hit) return Promise.resolve(hit);
  const url = savedArt(track.id) ?? (track.artwork.length ? pickArtwork(track.artwork, 200) : undefined);
  if (!url) return Promise.resolve(undefined);
  const running = inflight.get(track.id);
  if (running) return running;
  const job = getColors(url, { fallback: '#2a2a2a', cache: true, key: url })
    .then((c) => {
      const raw = c.platform === 'ios' ? { background: c.background, primary: c.primary, secondary: c.secondary, detail: c.detail } : c.platform === 'android' ? { background: c.dominant, primary: c.vibrant, secondary: c.muted } : {};
      const p = derivePalette(raw);
      mem.set(track.id, p);
      setJson(KEY(track.id), p);
      return p;
    })
    .catch(() => undefined)
    .finally(() => inflight.delete(track.id));
  inflight.set(track.id, job);
  return job;
}
