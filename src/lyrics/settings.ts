import { create } from 'zustand';

import { getJson, setJson } from '../util/storage';
import type { ProviderId } from './types';

export type SourceSetting = { id: ProviderId; enabled: boolean };
const KEY = 'lyrics.sources.v1';
export const DEFAULT_SOURCES: SourceSetting[] = [
  { id: 'lrclib', enabled: true },
  { id: 'lrcred', enabled: true },
  { id: 'netease', enabled: true },
  { id: 'ytmusic', enabled: true },
];

/** Sources that are not official APIs; the settings screens say so. */
export const THIRD_PARTY_SOURCES: ReadonlySet<ProviderId> = new Set<ProviderId>(['lrcred', 'netease']);
export const THIRD_PARTY_NOTE = 'Community/third-party source; may be unavailable.';

/** Keeps saved order/toggles, drops unknown ids and appends providers added since the save. */
export function mergeSources(saved: SourceSetting[] | undefined): SourceSetting[] {
  const known = new Set(DEFAULT_SOURCES.map((s) => s.id));
  const kept = (saved ?? []).filter((s) => known.has(s.id));
  const missing = DEFAULT_SOURCES.filter((d) => !kept.some((k) => k.id === d.id));
  return [...kept, ...missing];
}

export const useLyricsSources = create<{ sources: SourceSetting[] }>(() => ({ sources: mergeSources(getJson<SourceSetting[]>(KEY)) }));
export const lyricsSources = () => useLyricsSources.getState().sources;

function save(sources: SourceSetting[]) {
  useLyricsSources.setState({ sources });
  setJson(KEY, sources);
}
export const toggleSource = (id: ProviderId) => save(lyricsSources().map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
export function moveSource(id: ProviderId, dir: -1 | 1) {
  const list = [...lyricsSources()];
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  save(list);
}

/** Per-track sync offset in ms (user adjusted), stored in one map. */
const OFFSETS = 'lyrics.offsets.v1';
let offsets: Record<string, number> = getJson<Record<string, number>>(OFFSETS) ?? {};
export const useLyricsOffsets = create<{ offsets: Record<string, number> }>(() => ({ offsets }));
export function setLyricsOffset(videoId: string, ms: number) {
  offsets = { ...offsets };
  if (ms) offsets[videoId] = ms;
  else delete offsets[videoId];
  setJson(OFFSETS, offsets);
  useLyricsOffsets.setState({ offsets });
}
