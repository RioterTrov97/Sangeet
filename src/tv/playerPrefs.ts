import { create } from 'zustand';

import { getJson, setJson } from '../util/storage';
import { DEFAULT_LAYOUT, isVideoLyrics, parseLayout, type TvLayout, type VideoLyricsVariant } from './layout';

/** MMKV key of the remembered Now Playing layout. */
export const LAYOUT_KEY = 'tvPlayer.layout';

/** Persisted TV player preferences. The layout is restored on every launch and changes only when the user picks one. */
export const useTvPlayer = create<{ layout: TvLayout }>(() => ({ layout: parseLayout(getJson<string>(LAYOUT_KEY)) }));

export const tvLayout = (): TvLayout => useTvPlayer.getState().layout;

/** MMKV key of the Video + Lyrics variant used last (split or immersive), for the phone's Audio / Video switch. */
export const VL_KEY = 'tvPlayer.vlVariant';
export const lastVideoLyrics = (): VideoLyricsVariant => (getJson<string>(VL_KEY) === 'videoLyricsOverlay' ? 'videoLyricsOverlay' : 'videoLyrics');
export const rememberVideoLyrics = (l: TvLayout): void => {
  if (isVideoLyrics(l) && lastVideoLyrics() !== l) setJson(VL_KEY, l);
};

export function setTvLayout(layout: TvLayout): void {
  const l = parseLayout(layout);
  useTvPlayer.setState({ layout: l });
  setJson(LAYOUT_KEY, l);
  rememberVideoLyrics(l);
}

export { DEFAULT_LAYOUT };

/** MMKV key of "Keep playing in background" (TV only; default off: leaving the app pauses playback). */
export const BACKGROUND_KEY = 'tvPlayer.background';
export const useBackgroundPlay = create<{ on: boolean }>(() => ({ on: getJson<boolean>(BACKGROUND_KEY) === true }));
export const backgroundPlay = (): boolean => useBackgroundPlay.getState().on;
export function setBackgroundPlay(on: boolean): void {
  useBackgroundPlay.setState({ on });
  setJson(BACKGROUND_KEY, on);
}
