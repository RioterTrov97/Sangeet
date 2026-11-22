import { create } from 'zustand';

import { getJson, setJson } from '../util/storage';

const KEY = 'library.pins';

/** Pinned Library entries by key (`album-ID`, `local-ID`, 'liked', 'downloads', ...). Stored on the device only. */
export const usePins = create<{ keys: string[] }>(() => ({ keys: getJson<string[]>(KEY) ?? [] }));

export function togglePin(key: string): boolean {
  const keys = usePins.getState().keys;
  const on = !keys.includes(key);
  const next = on ? [key, ...keys] : keys.filter((k) => k !== key);
  usePins.setState({ keys: next });
  setJson(KEY, next);
  return on;
}
export const isPinned = (key: string) => usePins.getState().keys.includes(key);
export const useIsPinned = (key: string) => usePins((s) => s.keys.includes(key));
