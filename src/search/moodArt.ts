import { create } from 'zustand';

import { isOffline } from '../downloads/net';
import { log } from '../util/log';
import { getJson, setJson } from '../util/storage';
import type { Mood } from '../youtube/api';
import type { Shelf } from '../youtube/models';
import { pickArtwork } from '../youtube/mappers/common';
import { moodPageQuery } from '../youtube/queries';
import { queryClient } from '../youtube/queryClient';

/**
 * The picture on each Search mood tile, taken from the first item of its mood page. Kept on the device so the Search tab
 * does not fetch ~35 mood pages at once every time it opens (which made every request, including the one for the tile
 * the user tapped, take seconds). Missing or old pictures are fetched one page at a time in the background.
 */
const KEY = 'search.moodArt.v1';
/** A tile picture is refreshed after this long (mood pages change slowly). */
export const MOOD_ART_TTL_MS = 7 * 24 * 3600_000;
/** Wait after the Search tab opens before the first background fetch (the user's own taps go first). */
const START_DELAY_MS = 1500;

type Entry = { url: string | null; at: number };
const useMoodArtStore = create<Record<string, Entry>>(() => getJson<Record<string, Entry>>(KEY) ?? {});

export const useMoodArt = (params?: string): string | undefined => useMoodArtStore((s) => (params ? (s[params]?.url ?? undefined) : undefined));

/** The tile picture of a fetched mood page: the first item that has artwork. */
export function moodArtFrom(shelves: readonly Shelf[]): string | null {
  const art = shelves.flatMap((sh) => sh.items).find((i) => 'artwork' in i && i.artwork.length > 0);
  return (art && 'artwork' in art && pickArtwork(art.artwork, 160)) || null;
}

/** The moods whose picture is missing or older than the TTL. */
export function moodsNeedingArt(moods: readonly Mood[], known: Readonly<Record<string, Entry>>, now: number): Mood[] {
  return moods.filter((m) => m.params && (!known[m.params] || now - known[m.params].at > MOOD_ART_TTL_MS));
}

function save(params: string, url: string | null): void {
  useMoodArtStore.setState({ [params]: { url, at: Date.now() } });
  setJson(KEY, useMoodArtStore.getState());
}

let run = 0;
/** Fetches the missing tile pictures, one mood page at a time. A newer call (the tab opened again) replaces a running one. */
export function loadMoodArt(moods: readonly Mood[]): () => void {
  const my = ++run;
  const timer = setTimeout(async () => {
    const todo = moodsNeedingArt(moods, useMoodArtStore.getState(), Date.now());
    if (todo.length) log('search', `mood tile pictures: fetching ${todo.length} page(s) one at a time`);
    for (const m of todo) {
      if (my !== run || isOffline()) return;
      try {
        // Same cache entry as the Mood screen: a page fetched here opens instantly when its tile is tapped.
        const shelves = await queryClient.fetchQuery(moodPageQuery(m.params!));
        save(m.params!, moodArtFrom(shelves));
      } catch {
        // Not saved: tried again the next time the Search tab opens.
      }
    }
  }, START_DELAY_MS);
  return () => {
    clearTimeout(timer);
    if (run === my) run++;
  };
}

/** Starts fetching a tile's page as the finger goes down, so the Mood screen usually has it when it opens. */
export function prefetchMood(params?: string): void {
  if (params && !isOffline()) void queryClient.prefetchQuery(moodPageQuery(params));
}
