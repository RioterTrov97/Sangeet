import { create } from 'zustand';

import { getJson, setJson } from '../util/storage';

/** Content language (`hl`) and region (`gl`) override for every InnerTube request; undefined = "System default" (today's behaviour). */
export type ContentLocale = { lang?: string; region?: string };

export const LANGUAGE_OPTIONS: readonly { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'System default' },
  { value: 'en', label: 'English' },
  { value: 'ne', label: 'Nepali' },
  { value: 'hi', label: 'Hindi' },
];
export const REGION_OPTIONS: readonly { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'System default' },
  { value: 'NP', label: 'Nepal' },
  { value: 'IN', label: 'India' },
  { value: 'AU', label: 'Australia' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
];

const KEY = 'content.locale.v1';
const known = (list: typeof LANGUAGE_OPTIONS, v: unknown): string | undefined => (typeof v === 'string' && list.some((o) => o.value === v) ? v : undefined);
/** Drops anything that is not one of the offered values (a corrupt or old setting is just "System default"). */
export const sanitizeLocale = (raw: unknown): ContentLocale => {
  const r = (raw ?? {}) as Partial<ContentLocale>;
  return { lang: known(LANGUAGE_OPTIONS, r.lang), region: known(REGION_OPTIONS, r.region) };
};

export const useContentLocale = create<ContentLocale>(() => sanitizeLocale(getJson<ContentLocale>(KEY)));
export const contentLocale = (): ContentLocale => useContentLocale.getState();

/** The label of the current choice for a settings row. */
export const labelFor = (list: typeof LANGUAGE_OPTIONS, v: string | undefined): string => list.find((o) => o.value === v)?.label ?? 'System default';

/** Innertube.create options for the current setting (nothing when on System default, so the session is created exactly as before). */
export function localeSessionOptions(l: ContentLocale = contentLocale()): { lang?: string; location?: string } {
  return { ...(l.lang ? { lang: l.lang } : {}), ...(l.region ? { location: l.region } : {}) };
}

const listeners = new Set<() => void>();
/** The API module registers here to drop its sessions; the query cache listener clears Home and the rest of the YouTube data. */
export const onContentLocaleChange = (fn: () => void): (() => void) => (listeners.add(fn), () => void listeners.delete(fn));

export function setContentLocale(patch: Partial<ContentLocale>): void {
  const next = sanitizeLocale({ ...contentLocale(), ...patch });
  const cur = contentLocale();
  if (next.lang === cur.lang && next.region === cur.region) return;
  useContentLocale.setState(next, true);
  setJson(KEY, next);
  for (const fn of listeners) fn();
}
