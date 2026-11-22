import { Platform } from 'react-native';

import { playerState } from '../player/store';

/** Home data barely changes: on TV it is served from the (persisted) cache for this long before a background refresh is allowed. */
export const HOME_STALE_MS = 6 * 3600_000;

export type HomeCacheOptions = {
  staleTime?: number;
  refetchOnWindowFocus?: false;
  refetchOnReconnect?: false;
  refetchOnMount?: () => boolean;
};

/**
 * Query options for the Home queries. TV: stale after 6 h, never refetched on focus/reconnect, and no refetch (so no
 * Home rebuild) while something is playing. Other platforms keep each query's own settings.
 */
export function homeCacheOptions(tvBuild: boolean, isPlaying: () => boolean): HomeCacheOptions {
  if (!tvBuild) return {};
  return { staleTime: HOME_STALE_MS, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: () => !isPlaying() };
}

const playing = () => {
  const s = playerState().status;
  return s === 'playing' || s === 'buffering';
};
export const homeCache = (): HomeCacheOptions => homeCacheOptions(Platform.isTV, playing);
