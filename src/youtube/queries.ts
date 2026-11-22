import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { logWarn } from '../util/log';
import { contentLocale } from './contentLocale';
import { homeCache } from './homeCache';
import { latestReleases } from '../home/personalize';
import { moodShelf } from '../home/discover';
import { FALLBACK_MOODS, getAlbum, getCharts, getExplore, homeMorePage, type Mood, getUpNext, regionFromLocale, getArtist, getHome, getMoodPage, getMoods, getPlaylist, getSearchSuggestions, search, searchAll } from './api';
import type { Album, Artist, MusicItem, Page, SearchType, Shelf, Track } from './models';

/** Flattens a lazily-paged result into useInfiniteQuery plumbing. */
function pagedOptions<T>(key: unknown[], first: () => Promise<Page<T>>, enabled = true) {
  return {
    queryKey: ['yt', ...key],
    enabled,
    initialPageParam: undefined as (() => Promise<Page<T>>) | undefined,
    queryFn: ({ pageParam }: { pageParam: (() => Promise<Page<T>>) | undefined }) => (pageParam ? pageParam() : first()),
    getNextPageParam: (last: Page<T>) => last.next,
  };
}

export const useSearchSuggestions = (q: string) =>
  useQuery({
    queryKey: ['yt', 'suggest', q],
    queryFn: () => getSearchSuggestions(q),
    enabled: q.trim().length > 0,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });

export const useSearchAll = (q: string) =>
  useQuery({ queryKey: ['yt', 'search-all', q], queryFn: () => searchAll(q), enabled: q.trim().length > 0 });

export function useSearchType(q: string, type: SearchType) {
  const r = useInfiniteQuery(pagedOptions<MusicItem>(['inf-search', type, q], () => search(q, type), q.trim().length > 0));
  return { ...r, items: r.data?.pages.flatMap((p) => p.items) ?? [] };
}

export const useAlbum = (id: string) => useQuery({ queryKey: ['yt', 'album', id], queryFn: () => getAlbum(id), staleTime: 3600_000 });
export const useArtist = (id: string) => useQuery({ queryKey: ['yt', 'artist', id], queryFn: () => getArtist(id), staleTime: 3600_000 });
export const useHome = () => useQuery({ queryKey: ['yt', 'home'], queryFn: getHome, ...homeCache() });

/** Playlist header + paged tracks. */
export function usePlaylist(id: string) {
  const r = useInfiniteQuery({
    queryKey: ['yt', 'inf-playlist', id],
    initialPageParam: undefined as (() => Promise<Page<Track>>) | undefined,
    queryFn: async ({ pageParam }) => {
      if (pageParam) return { page: await pageParam(), header: undefined };
      const p = await getPlaylist(id);
      return { page: p.tracks, header: p };
    },
    getNextPageParam: (last) => last.page.next,
  });
  const header = r.data?.pages[0]?.header;
  return { ...r, playlist: header?.playlist, description: header?.description, countText: header?.countText, tracks: r.data?.pages.flatMap((p) => p.page.items) ?? [] };
}

/** Real tiles from the Moods & genres page; if the fetch fails (logged once with the reason) the static params-carrying fallback is shown, uncached. */
export function useMoods(enabled = true) {
  const r = useQuery({ queryKey: ['yt', 'moods', 'v2'], queryFn: getMoods, staleTime: 24 * 3600_000, enabled, ...homeCache(), ...(Platform.isTV ? { staleTime: 24 * 3600_000 } : {}) });
  const failed = r.isError;
  const reason = r.error instanceof Error ? r.error.message : String(r.error);
  useEffect(() => {
    if (failed) logWarn('api', `getMoods failed, using built-in mood list: ${reason}`);
  }, [failed, reason]);
  return { ...r, data: r.data ?? FALLBACK_MOODS };
}

/** `fetch: false` only reads what is already cached (used by TV mood tiles until one is focused). */
/** One mood / genre page (shared by the Mood screen and the Search tiles' picture loader, so a fetched page opens instantly). */
export const moodPageQuery = (params: string) => ({ queryKey: ['yt', 'mood', params] as const, queryFn: () => getMoodPage(params), staleTime: 6 * 3600_000 });
export const useMoodPage = (params: string | undefined, fetch = true) => useQuery({ ...moodPageQuery(params ?? ''), enabled: !!params && fetch });

/** The region used for region-specific pages: the content-region setting when one is chosen, else the device's. */
export const deviceRegion = () => {
  const chosen = contentLocale().region;
  if (chosen) return chosen;
  try {
    return regionFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return undefined;
  }
};

/** Trending / new releases / new music videos for the device region, falling back to the global (IP-based) page. Cached ~6h. */
export const useExplore = () => {
  const region = deviceRegion();
  return useQuery({
    queryKey: ['yt', 'explore', 'v2', region ?? 'auto'],
    queryFn: async () => {
      if (!region) return getExplore();
      try {
        return await getExplore(region);
      } catch (e) {
        logWarn('api', `explore for region ${region} failed, using global: ${e instanceof Error ? e.message : e}`);
        return getExplore();
      }
    },
    staleTime: 6 * 3600_000,
    ...homeCache(),
  });
};

/** Radio / "up next" list for a seed track, for the "Because you listened to" shelves. */
export const useBecause = (seedId: string | undefined) =>
  useQuery({ queryKey: ['yt', 'because', seedId], queryFn: () => getUpNext(seedId!), enabled: !!seedId, staleTime: 3 * 3600_000, ...homeCache() });

/** Top artists + chart playlists for the device region (falls back to the global page). Cached ~6h. */
export const useCharts = (enabled = true) => {
  const region = deviceRegion();
  return useQuery({
    enabled,
    queryKey: ['yt', 'charts', region ?? 'auto'],
    queryFn: async () => {
      if (!region) return getCharts();
      try {
        return await getCharts(region);
      } catch (e) {
        logWarn('api', `charts for region ${region} failed, using global: ${e instanceof Error ? e.message : e}`);
        return getCharts();
      }
    },
    staleTime: 6 * 3600_000,
    ...homeCache(),
  });
};

/** One shelf for a mood/genre tile (its first playlist carousels merged). */
export function useMoodShelf(mood: Mood) {
  const r = useMoodPage(mood.params);
  return { ...r, shelf: r.data ? moodShelf(mood.title, r.data) : undefined } as { isLoading: boolean; isError: boolean; error: unknown; shelf: Shelf | undefined };
}

/** YT Music Home continuation (infinite scroll). Not persisted; anonymous sessions may return nothing, which just ends the list. */
export function useHomeMore(enabled: boolean) {
  const r = useInfiniteQuery({ ...pagedOptions<Shelf>(['inf-home-more'], () => homeMorePage(), enabled), retry: false, staleTime: 30 * 60_000, ...homeCache() });
  return { ...r, shelves: r.data?.pages.flatMap((p) => p.items) ?? [] };
}

/** Latest releases of each followed artist (artist page data, cached ~12h per artist). */
export function useFollowedReleases(artists: Artist[], max = 8): { releases: Album[][]; loading: boolean } {
  const list = artists.slice(0, max);
  const results = useQueries({
    queries: list.map((a) => ({
      queryKey: ['yt', 'artist-latest', a.id],
      queryFn: async () => latestReleases(await getArtist(a.id), 2),
      staleTime: 12 * 3600_000,
      retry: false,
      ...homeCache(),
    })),
  });
  return { releases: results.map((r) => r.data ?? []), loading: results.some((r) => r.isLoading) };
}
