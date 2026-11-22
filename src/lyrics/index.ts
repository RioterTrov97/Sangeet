import { isLocalId } from '../local/id';
import { log, logWarn } from '../util/log';
import { getJson, setJson } from '../util/storage';
import type { Track } from '../youtube/models';
import { lrclib } from './providers/lrclib';
import { lrcred } from './providers/lrcred';
import { netease } from './providers/netease';
import { ytmusic } from './providers/ytmusic';
import { lyricsSources, type SourceSetting } from './settings';
import { stripCreditsPlain, stripCreditsSynced } from './credits';
import { lyricsFromLrcFile } from './fileLyrics';
import { fitsDuration, toPlain } from './fit';
import { isDevanagari, looksDevanagari } from './script';
import type { Lyrics, LyricsProvider, ProviderId } from './types';

export const PROVIDERS: Record<ProviderId, LyricsProvider> = { lrclib, lrcred, netease, ytmusic };

const DAY = 86_400_000;
export const FOUND_TTL = 30 * DAY;
export const MISS_TTL = DAY;
type CacheEntry = { at: number; data: Lyrics | null };
const key = (id: string) => `lyrics.v1.${id}`;

export type Deps = {
  providers: Record<string, LyricsProvider>;
  sources: () => SourceSetting[];
  now: () => number;
  read: (k: string) => CacheEntry | undefined;
  write: (k: string, v: CacheEntry) => void;
  /** Per-provider and overall time limits (default 8 s / 25 s). */
  providerTimeoutMs?: number;
  overallTimeoutMs?: number;
  /** Grace for the lrclib + lrcred pair (default 1.5 s). */
  parallelGraceMs?: number;
  /** Text of the `.lrc` file next to a song from this iPhone, if there is one. */
  sidecar?: (id: string) => string | undefined;
};
export const PROVIDER_TIMEOUT_MS = 8000;
export const OVERALL_TIMEOUT_MS = 25_000;

class TimedOut extends Error {}

/** Runs `fn` with an AbortSignal that fires after `ms` (or when `parent` aborts); also stops waiting if `fn` ignores the signal. */
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, parent: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  const onParent = () => ctl.abort();
  parent.addEventListener('abort', onParent);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => ctl.abort(), ms);
    ctl.signal.addEventListener('abort', () => reject(new TimedOut(`timed out after ${ms} ms`)));
  });
  try {
    return await Promise.race([fn(ctl.signal), limit]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onParent);
  }
}

/** Credit lines ("Lyrics by", "Music:", ...) at the very start / end of the text are dropped. */
function cleanCredits(l: Lyrics): Lyrics {
  return { ...l, synced: l.synced ? stripCreditsSynced(l.synced) : undefined, plain: l.plain ? stripCreditsPlain(l.plain) : undefined };
}
let sidecarReader: ((id: string) => string | undefined) | undefined;
/** The local-songs module registers how a `.lrc` file next to a song is read (kept out of this module: it needs native file access). */
export const setLyricsSidecar = (fn: ((id: string) => string | undefined) | undefined) => void (sidecarReader = fn);
const defaults: Deps = { providers: PROVIDERS, sources: lyricsSources, now: Date.now, read: (k) => getJson<CacheEntry>(k), write: setJson, sidecar: (id) => sidecarReader?.(id) };

const inflight = new Map<string, Promise<Lyrics | null>>();

/** Providers to try, in the user's order, skipping disabled ones. */
export const activeProviders = (sources: SourceSetting[], providers: Record<string, LyricsProvider>) =>
  sources.filter((s) => s.enabled).map((s) => providers[s.id]).filter(Boolean);

/**
 * Cache (30 days; "not found" 1 day) then each enabled provider in order. A provider that errors is skipped.
 * Synced lyrics win: if an earlier provider only had plain text, later ones are tried for synced and the plain
 * result is kept as the fallback.
 */
export function getLyrics(track: Track, deps: Deps = defaults): Promise<Lyrics | null> {
  // A .lrc file next to a song from this iPhone wins over every source (and is read each time, so editing it takes effect).
  const file = isLocalId(track.id) ? deps.sidecar?.(track.id) : undefined;
  const own = file ? lyricsFromLrcFile(file) : null;
  if (own) return Promise.resolve(own);
  const hit = deps.read(key(track.id));
  if (hit && deps.now() - hit.at < (hit.data ? FOUND_TTL : MISS_TTL)) return Promise.resolve(hit.data);
  let p = inflight.get(track.id);
  if (!p) {
    p = fetchLyrics(track, deps).finally(() => inflight.delete(track.id));
    inflight.set(track.id, p);
  }
  // Expired but still on the device: used whenever a fresh lookup brings nothing back (offline, a provider down), so a
  // saved song keeps its lyrics however long the phone stays offline.
  const old = hit?.data;
  return old ? p.then((r) => r ?? old, () => old) : p;
}

/** Each provider gets 8 s, the whole lookup 25 s; a provider that times out is skipped (and the miss is not cached). */
export async function fetchLyrics(track: Track, deps: Deps): Promise<Lyrics | null> {
  const overall = new AbortController();
  const timer = setTimeout(() => overall.abort(), deps.overallTimeoutMs ?? OVERALL_TIMEOUT_MS);
  try {
    return await fetchWith(track, deps, overall.signal);
  } finally {
    clearTimeout(timer);
  }
}

type Outcome = { p: LyricsProvider; lyrics?: Lyrics; fits: boolean; failed: boolean };

/** One provider, with its own time limit; never throws. `fits` = synced and timed for this recording. */
async function attempt(p: LyricsProvider, track: Track, deps: Deps, overall: AbortSignal): Promise<Outcome> {
  if (overall.aborted) {
    logWarn('lyrics', `${track.id}: overall time limit reached; skipping ${p.id}`);
    return { p, fits: false, failed: true };
  }
  try {
    const r = await withTimeout((signal) => p.getLyrics(track, signal), deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS, overall);
    if (!r || (!r.synced?.length && !r.plain)) return { p, fits: false, failed: false };
    const lyrics = cleanCredits({ ...r, source: p.label, providerId: p.id });
    if (!lyrics.synced?.length && !lyrics.plain) return { p, fits: false, failed: false };
    if (lyrics.synced?.length) {
      const fits = fitsDuration(lyrics.synced, lyrics.durationSec, track.durationSec);
      if (!fits) log('lyrics', `${track.id} ${p.id} synced lyrics are for another version (${lyrics.durationSec ?? 'last line ' + lyrics.synced[lyrics.synced.length - 1].time}s vs ${track.durationSec}s); trying the next source`);
      return { p, lyrics, fits, failed: false };
    }
    return { p, lyrics, fits: false, failed: false };
  } catch (e) {
    logWarn('lyrics', `${p.id} failed for ${track.id}${e instanceof TimedOut ? ' (timed out)' : ''}`, e instanceof Error ? e.message : e);
    return { p, fits: false, failed: true };
  }
}

/** lrclib and lrcred are asked at the same time (when both are on, at the place of the earlier one); the rest one by one. */
export function planGroups(list: LyricsProvider[]): LyricsProvider[][] {
  const pair = list.filter((p) => p.id === 'lrclib' || p.id === 'lrcred');
  if (pair.length < 2) return list.map((p) => [p]);
  const out: LyricsProvider[][] = [];
  for (const p of list) {
    if (p === pair[0]) out.push(['lrclib', 'lrcred'].map((id) => pair.find((x) => x.id === id)!));
    else if (!pair.includes(p)) out.push([p]);
  }
  return out;
}

/** How long the parallel pair waits for the other source once one has synced lyrics (lrclib is preferred when both match). */
export const PARALLEL_GRACE_MS = 1500;

async function runGroup(group: LyricsProvider[], track: Track, deps: Deps, overall: AbortSignal): Promise<Outcome[]> {
  if (group.length === 1) return [await attempt(group[0], track, deps, overall)];
  const tasks = group.map((p) => attempt(p, track, deps, overall));
  const done: (Outcome | undefined)[] = group.map(() => undefined);
  const tagged = tasks.map((t, i) => t.then((o) => ((done[i] = o), i)));
  const first = await Promise.race(tagged);
  const o = done[first]!;
  // A synced lrclib result already in Devanagari needs no waiting (nothing can beat it); otherwise the other source gets a short grace.
  const decisive = o.fits && first === 0 && isDevanagari(o.lyrics!);
  if (!o.fits || o.failed || !o.lyrics) await Promise.all(tasks);
  else if (!decisive) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(tasks), new Promise((r) => (timer = setTimeout(r, deps.parallelGraceMs ?? PARALLEL_GRACE_MS)))]);
    clearTimeout(timer);
  }
  return done.filter((x): x is Outcome => !!x);
}

async function fetchWith(track: Track, deps: Deps, overall: AbortSignal): Promise<Lyrics | null> {
  let plainOnly: Lyrics | null = null;
  let wrongVersion: Lyrics | null = null; // synced, but timed for a different-length recording
  let latinSynced: Lyrics | null = null; // synced, in Latin letters, for a Devanagari track: kept while a Devanagari one is looked for
  let failed = false;
  const wantsDev = looksDevanagari(track);
  for (const group of planGroups(activeProviders(deps.sources(), deps.providers))) {
    const outcomes = await runGroup(group, track, deps, overall);
    const synced: Lyrics[] = [];
    for (const o of outcomes) {
      failed ||= o.failed;
      if (!o.lyrics) continue;
      if (o.lyrics.synced?.length) {
        if (o.fits) synced.push(o.lyrics);
        else wrongVersion ??= o.lyrics;
      } else plainOnly ??= o.lyrics;
    }
    // Native script first among equally synced results; ties keep the provider order (lrclib before lrcred).
    const best = synced.find(isDevanagari) ?? synced[0];
    if (!best) continue;
    if (isDevanagari(best) || !wantsDev) return finish(track, deps, best);
    latinSynced ??= best;
  }
  if (latinSynced) return finish(track, deps, latinSynced);
  // Don't cache a miss caused by network errors; retry next time.
  if (!plainOnly && !wrongVersion && failed) return null;
  return finish(track, deps, plainOnly ?? (wrongVersion ? toPlain(wrongVersion) : null));
}

function finish(track: Track, deps: Deps, data: Lyrics | null): Lyrics | null {
  deps.write(key(track.id), { at: deps.now(), data });
  log('lyrics', `${track.id} -> ${data ? `${data.source} ${data.synced ? 'synced' : 'plain'}` : 'not found'}`);
  return data;
}

/** Warms the cache; errors are swallowed. */
export function prefetchLyrics(track: Track | undefined): void {
  if (track) void getLyrics(track).catch(() => {});
}
