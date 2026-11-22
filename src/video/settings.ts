import { create } from 'zustand';

import { getJson, setJson } from '../util/storage';

/** MMKV key of "Use lyric videos when there is no music video". */
export const ALLOW_LYRIC_KEY = 'video.allowLyric';

/** Lyric videos (tier B) are on by default: a same-song, same-artist lyric video beats no video. */
export const useVideoSettings = create<{ allowLyric: boolean }>(() => ({ allowLyric: getJson<boolean>(ALLOW_LYRIC_KEY) !== false }));
export const allowLyric = (): boolean => useVideoSettings.getState().allowLyric;
export function setAllowLyric(on: boolean): void {
  useVideoSettings.setState({ allowLyric: on });
  setJson(ALLOW_LYRIC_KEY, on);
}
