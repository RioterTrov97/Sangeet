import { create } from 'zustand';

import { getJson, setJson } from '../util/storage';

export type DownloadQuality = 'normal' | 'high';
export type DownloadSettings = {
  quality: DownloadQuality;
  wifiOnly: boolean;
  /** GB; 0 = unlimited. */
  limitGb: number;
  autoDownloadLiked: boolean;
  /** Automatic offline storage (songs saved whole as they play), MB; 0 = off. */
  autoCacheMb: number;
};

/** Default automatic offline storage on phone and TV. */
export const AUTO_CACHE_DEFAULT_MB = 1024;
export const AUTO_CACHE_OPTIONS_MB = [500, 1024, 2048, 0] as const;

const KEY = 'downloads.settings.v1';
const DEFAULTS: DownloadSettings = { quality: 'normal', wifiOnly: true, limitGb: 0, autoDownloadLiked: false, autoCacheMb: AUTO_CACHE_DEFAULT_MB };

export const useDownloadSettings = create<DownloadSettings>(() => ({ ...DEFAULTS, ...(getJson<Partial<DownloadSettings>>(KEY) ?? {}) }));
export const downloadSettings = () => useDownloadSettings.getState();

export function setDownloadSettings(patch: Partial<DownloadSettings>): void {
  useDownloadSettings.setState(patch);
  const { quality, wifiOnly, limitGb, autoDownloadLiked, autoCacheMb } = useDownloadSettings.getState();
  setJson(KEY, { quality, wifiOnly, limitGb, autoDownloadLiked, autoCacheMb });
}
