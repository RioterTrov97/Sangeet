import { Image } from 'expo-image';

import { useLibraryStore } from '../library/store';
import { getHistory } from '../player/history';
import { artworkUri } from '../ui/Artwork';
import { whenStartupReady } from '../util/startup';

const CARD_ART = 56;
const PER_LIST = 24;

/**
 * Warms the image cache for the Library's History and Liked grids a few seconds after launch (the first ~24 cards of each), so
 * opening them draws the artwork from disk instead of waiting on the network for two dozen thumbnails at once.
 */
export function prefetchLibraryArt(): () => void {
  let live = true;
  const id = setTimeout(() => whenStartupReady(() => live && run()), 1000);
  const run = () => {
    try {
      const tracks = [...getHistory().slice(0, PER_LIST), ...useLibraryStore.getState().liked.slice(0, PER_LIST)];
      const urls = [...new Set(tracks.map((t) => artworkUri(t.artwork, CARD_ART)).filter((u): u is string => !!u))];
      if (urls.length) void Image.prefetch(urls, 'disk').catch(() => false);
    } catch {
      /* best effort */
    }
  };
  return () => {
    live = false;
    clearTimeout(id);
  };
}
