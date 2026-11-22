import { create } from 'zustand';

import { logWarn, log } from '../util/log';
import { isLocalId } from '../local/id';
import { getJson, setJson, storage } from '../util/storage';
import { normalizeArtist, normalizeTitle } from '../lyrics/normalize';
import { getVideoCounterpart, getVideoMeta, hasAuthCookieSet, searchWebVideos, searchYtmVideos, type VideoMeta } from '../youtube/api';
import type { Track } from '../youtube/models';
import { videoIdFor } from './logic';
import { MATCHER_VERSION, mergeCandidates, rankVideoCandidates, type MatchSong, type Scored, type VideoCandidate, type VideoTier } from './match';
import { noteVideoDuration } from './offsets';
import { allowLyric, useVideoSettings } from './settings';

const KEY = 'video.counterparts.v4';
const KEY_V3 = 'video.counterparts.v3'; // v3: songId -> video id (hits only), migrated once
const OVERRIDE_KEY = 'video.override.v1';

/** A candidate as kept for the picker (a slim copy of a ranked one). */
export type SlimCand = { id: string; title: string; ch?: string; verified?: boolean; dur?: number; views?: number; tier: VideoTier; score: number };
type Entry = { id: string | null; tier?: VideoTier; score?: number; at: number; v: number; cands?: SlimCand[] };

/** A miss is asked again after this long (the album year is not known here, so no shorter "new release" window). */
export const MISS_TTL_MS = 7 * 24 * 3600_000;
/** A lookup that failed part way (429, offline) is asked again after this long. */
export const PARTIAL_RETRY_MS = 10 * 60_000;
/** Most `/next` lookups per song to check a web-only pick. */
export const MAX_VERIFY = 2;
const MAX_ENTRIES = 2000;
const NONE = 'none';

const slim = (s: Scored): SlimCand => ({ id: s.id, title: s.title, ch: s.channel?.name, verified: s.channel?.verified || undefined, dur: s.durationSec, views: s.views, tier: s.tier, score: Math.round(s.score * 1000) / 1000 });

// ---------- persisted state ----------
/** Drops what a newer matcher would recompute (non-A hits, misses), and expired misses. */
export function loadEntries(raw: Record<string, Entry> | undefined, now = Date.now()): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const [id, e] of Object.entries(raw ?? {})) {
    if (!e || typeof e !== 'object') continue;
    if (e.v < MATCHER_VERSION && (e.tier !== 'A' || !e.id)) continue;
    if (!e.id && now - e.at > MISS_TTL_MS) continue;
    out[id] = e;
  }
  return out;
}

function migrateV3(entries: Record<string, Entry>, now = Date.now()): boolean {
  const old = getJson<Record<string, string | null>>(KEY_V3);
  if (!old) return false;
  for (const [songId, vid] of Object.entries(old)) if (vid && !(songId in entries)) entries[songId] = { id: vid, tier: 'A', at: now, v: 3 };
  try {
    storage.remove(KEY_V3);
  } catch {}
  return true;
}

const entries: Record<string, Entry> = loadEntries(getJson<Record<string, Entry>>(KEY));
if (migrateV3(entries)) setJson(KEY, entries);
const overrides: Record<string, string> = getJson<Record<string, string>>(OVERRIDE_KEY) ?? {};
/** Lookups that failed part way: answered `null` for now, asked again after PARTIAL_RETRY_MS. Not persisted. */
const partialAt = new Map<string, number>();
const inflight = new Map<string, Promise<string | null>>();
/** Videos that would not play, per song, so the fallback never offers one twice. */
const unplayable = new Map<string, Set<string>>();

const known: Record<string, string | null> = {};
function seedKnown(): void {
  for (const k of Object.keys(known)) delete known[k];
  for (const [s, e] of Object.entries(entries)) if (e.id) known[s] = e.id;
  for (const [s, o] of Object.entries(overrides)) known[s] = o === NONE ? null : o;
}
seedKnown();

/** songId -> video id, or null when the song has no video. Persisted hits and overrides; a miss is kept only after a lookup ran. */
export const useCounterparts = create<{ map: Record<string, string | null> }>(() => ({ map: { ...known } }));
const publish = () => useCounterparts.setState({ map: { ...known } });

function persist(): void {
  const keys = Object.keys(entries);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => entries[a].at - entries[b].at);
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[k];
  }
  setJson(KEY, entries);
}

type ChosenListener = (songId: string, videoId: string | null) => void;
const chosenListeners = new Set<ChosenListener>();
/** Called when the picker (or "Check again") changes the video of a song. Returns the unsubscribe. */
export function onVideoChosen(fn: ChosenListener): () => void {
  chosenListeners.add(fn);
  return () => void chosenListeners.delete(fn);
}

// ---------- the chain ----------
export type ChainDeps = {
  counterpart: (id: string) => Promise<string | null>;
  ytmVideos: (query: string) => Promise<Track[]>;
  webVideos: (query: string) => Promise<VideoCandidate[]>;
  meta: (id: string) => Promise<VideoMeta | null>;
  signedIn: () => boolean;
};
const realDeps = (): ChainDeps => ({ counterpart: getVideoCounterpart, ytmVideos: searchYtmVideos, webVideos: searchWebVideos, meta: getVideoMeta, signedIn: hasAuthCookieSet });

export type ChainResult = { best?: Scored; ranked: Scored[]; /** Set when `/next` named the video: no candidates were ranked. */ direct?: string; partial: boolean; requests: number; layers: string[] };

const asSong = (t: Track): MatchSong => ({ id: t.id, title: t.title, artists: t.artists, durationSec: t.durationSec, album: t.album?.name });

export function fromTrack(t: Track): VideoCandidate {
  return {
    id: t.id,
    title: t.title,
    channel: t.artists.length ? { name: t.artists.map((a) => a.name).join(', ') } : undefined,
    durationSec: t.durationSec,
    views: t.views,
    videoType: t.videoType,
    artists: t.artists,
    source: 'ytm',
  };
}

/**
 * The fallback chain for one song. Layers run only while no tier A exists yet; candidates accumulate and are re-ranked after each layer:
 * `/next` counterpart (signed in), YouTube Music video search, web search (then "... official video"), and after each a `/next` check
 * (at most MAX_VERIFY per song) of a web-only pick, which rejects audio-only and fills the artist list. Tier B only counts when `lyric`.
 * A layer that throws makes the result partial.
 */
export async function runChain(track: Track, opts: { lyric: boolean; skipDirect?: boolean }, deps: ChainDeps = realDeps()): Promise<ChainResult> {
  const song = asSong(track);
  const pools: VideoCandidate[][] = [];
  const metas = new Map<string, VideoMeta>();
  const layers: string[] = [];
  let partial = false;
  let requests = 0;
  let verifies = 0;
  const rank = () => rankVideoCandidates(song, mergeCandidates(pools).map((c) => (metas.has(c.id) ? { ...c, ...metas.get(c.id) } : c)), { allowLyric: opts.lyric });
  const verify = async () => {
    for (;;) {
      const { best } = rank();
      if (!best || !best.needsVerify || metas.has(best.id) || verifies >= MAX_VERIFY) return;
      verifies++;
      requests++;
      try {
        const m = await deps.meta(best.id);
        // `/next` did not start with this video: nothing to learn, treat it as a plain upload without credits.
        metas.set(best.id, m ?? { videoType: 'plain', artists: [] });
      } catch (e) {
        partial = true;
        logWarn('video', `verify ${best.id} failed`, e instanceof Error ? e.message : e);
        return;
      }
    }
  };
  const layer = async (name: string, fn: () => Promise<VideoCandidate[]>) => {
    requests++;
    layers.push(name);
    try {
      pools.push(await fn());
    } catch (e) {
      partial = true;
      logWarn('video', `${name} failed for ${track.id}`, e instanceof Error ? e.message : e);
      return;
    }
    await verify();
  };
  const haveA = () => rank().best?.tier === 'A';

  if (deps.signedIn() && !opts.skipDirect) {
    requests++;
    layers.push('next');
    try {
      const direct = await deps.counterpart(track.id);
      if (direct) return { ranked: [], direct, partial, requests, layers };
    } catch (e) {
      partial = true;
      logWarn('video', `counterpart failed for ${track.id}`, e instanceof Error ? e.message : e);
    }
  }
  const query = `${normalizeTitle(track.title)} ${normalizeArtist(track.artists[0]?.name ?? '')}`.trim();
  await layer('ytm', async () => (await deps.ytmVideos(query)).map(fromTrack));
  if (!haveA()) await layer('web', () => deps.webVideos(query));
  if (!haveA()) await layer('web+official', () => deps.webVideos(`${query} official video`));
  const { ranked, best } = rank();
  return { ranked, best, partial, requests, layers };
}

// ---------- lookup and cache ----------
function store(track: Track, r: ChainResult): string | null {
  const now = Date.now();
  const id = r.direct ?? r.best?.id ?? null;
  if (r.partial && !id) {
    partialAt.set(track.id, now);
    log('video', `chain ${track.id}: partial miss after ${r.requests} requests (${r.layers.join(',')}), retry in 10 min`);
    return null;
  }
  partialAt.delete(track.id);
  entries[track.id] = { id, tier: r.direct ? 'A' : r.best?.tier, score: r.best ? Math.round(r.best.score * 1000) / 1000 : undefined, at: now, v: MATCHER_VERSION, cands: r.direct ? undefined : r.ranked.slice(0, 5).map(slim) };
  persist();
  if (r.best) noteVideoDuration(r.best.id, r.best.durationSec);
  log('video', `chain ${track.id}: ${id ? `${r.direct ? 'next' : r.best?.tier} ${id}${r.best ? ` score ${r.best.score.toFixed(2)}` : ''}` : 'no video'} after ${r.requests} requests (${r.layers.join(',')})`);
  return id;
}

async function lookup(track: Track): Promise<string | null> {
  const r = await runChain(track, { lyric: allowLyric() });
  const id = store(track, r);
  known[track.id] = id;
  publish();
  return id;
}

/** Cached answer for the song when still valid: override first, then a persisted hit or a fresh miss. `undefined` = look it up. */
function cached(songId: string, now = Date.now()): string | null | undefined {
  const o = overrides[songId];
  if (o) return o === NONE ? null : o;
  const e = entries[songId];
  if (e) {
    if (e.id) return e.id;
    if (now - e.at <= MISS_TTL_MS) return null;
    return undefined;
  }
  const p = partialAt.get(songId);
  if (p != null && now - p < PARTIAL_RETRY_MS) return null;
  return undefined;
}

/** Resolves the video id for a track (itself when it is a video). Null = no video exists. Failures are not persisted. */
export async function resolveVideoId(track: Track): Promise<string | null> {
  if (isLocalId(track.id)) return null; // a file on this iPhone has no YouTube video
  if (track.isVideo || track.videoType === 'official') return track.id;
  const c = cached(track.id);
  if (c !== undefined) {
    if (!(track.id in known)) {
      known[track.id] = c;
      publish();
    }
    return c;
  }
  let p = inflight.get(track.id);
  if (!p) {
    p = lookup(track)
      .catch((e) => {
        logWarn('video', `counterpart lookup failed for ${track.id}`, e instanceof Error ? e.message : e);
        partialAt.set(track.id, Date.now());
        return null;
      })
      .finally(() => inflight.delete(track.id));
    inflight.set(track.id, p);
  }
  return p;
}

/** The video id for a track when it is already known (no lookup is started): the track itself when it is a video, else the cached counterpart. */
export const knownVideoId = (track: Track): string | null => (isLocalId(track.id) ? null : track.isVideo || track.videoType === 'official' ? track.id : (useCounterparts.getState().map[track.id] ?? null));

/** The kind of the video chosen for a track (A music video, B lyric video, C other) when known; the track's own video is a music video. */
export function knownVideoTier(track: Track): VideoTier | undefined {
  if (track.isVideo || track.videoType === 'official') return 'A';
  const o = overrides[track.id];
  const e = entries[track.id];
  if (o && o !== NONE) return e?.cands?.find((c) => c.id === o)?.tier;
  return o ? undefined : e?.tier;
}

/** undefined while still looking, null when the track has no video. */
export function useVideoId(track: Track | undefined): string | null | undefined {
  const map = useCounterparts((s) => s.map);
  if (!track || isLocalId(track.id)) return null;
  if (track.isVideo || track.videoType === 'official') return track.id;
  if (track.id in map) return videoIdFor(track, map[track.id]);
  void resolveVideoId(track);
  return undefined;
}

// ---------- picker API ----------
export type VideoChoice = { cands: SlimCand[]; current: string | null; overridden: boolean };

const choiceOf = (songId: string): VideoChoice => ({ cands: entries[songId]?.cands ?? [], current: known[songId] ?? null, overridden: !!overrides[songId] });

/** True when the user chose a video (or none) for this song. */
export const hasOverride = (songId: string): boolean => !!overrides[songId];

/** True when the picker makes sense: the track is not itself a video. */
export const canChooseVideo = (t: Track | undefined): t is Track => !!t && !isLocalId(t.id) && !(t.isVideo || t.videoType === 'official');

/** The candidates for the picker: from the cache, else the chain runs now (the video already chosen stays; only the list is filled in). */
export async function getVideoCandidates(track: Track): Promise<VideoChoice> {
  if (entries[track.id]?.cands === undefined) await refresh(track, true);
  return choiceOf(track.id);
}

/** Runs the chain again for this song, ignoring the cache ("Check again"). A video the user chose stays chosen. */
export function recheckVideo(track: Track): Promise<VideoChoice> {
  return refresh(track, false).then(() => choiceOf(track.id));
}

async function refresh(track: Track, keepCurrent: boolean): Promise<void> {
  const old = entries[track.id];
  const r = await runChain(track, { lyric: allowLyric(), skipDirect: true });
  if (r.partial && !r.best) return; // keep the old answer and candidates
  const prev = known[track.id] ?? null;
  if (keepCurrent && old?.id) {
    entries[track.id] = { ...old, cands: r.ranked.slice(0, 5).map(slim) };
    persist();
    return;
  }
  const id = store(track, r);
  if (overrides[track.id]) return void publish();
  known[track.id] = id;
  publish();
  if (id !== prev) chosenListeners.forEach((f) => f(track.id, id));
}

/** The user's pick: a video id, `'none'` (no video for this song) or null (back to automatic). */
export function chooseVideo(songId: string, videoId: string | null): void {
  if (videoId === null) {
    delete overrides[songId];
    delete entries[songId];
    delete known[songId];
    partialAt.delete(songId);
    persist();
  } else {
    overrides[songId] = videoId;
    known[songId] = videoId === NONE ? null : videoId;
    const c = entries[songId]?.cands?.find((x) => x.id === videoId);
    if (c) noteVideoDuration(c.id, c.dur);
  }
  setJson(OVERRIDE_KEY, overrides);
  publish();
  chosenListeners.forEach((f) => f(songId, videoId === null ? null : videoId === NONE ? null : videoId));
}

/**
 * The video of `songId` would not play: move to the next tier-A candidate, else to no video. Returns the new id (null = none).
 * A choice the user made is left alone (they asked for that video).
 */
export function markVideoUnplayable(songId: string, videoId: string): string | null {
  const bad = unplayable.get(songId) ?? new Set<string>();
  bad.add(videoId);
  unplayable.set(songId, bad);
  const e = entries[songId];
  if (overrides[songId] || !e || e.id !== videoId) return known[songId] ?? null;
  const next = e.cands?.find((c) => c.tier === 'A' && !bad.has(c.id));
  entries[songId] = { ...e, id: next?.id ?? null, tier: next?.tier, score: next?.score, at: Date.now() };
  persist();
  known[songId] = next?.id ?? null;
  publish();
  log('video', `${songId}: ${videoId} would not play -> ${next ? `next candidate ${next.id}` : 'no video'}`);
  return next?.id ?? null;
}

/** Drops answers a changed lyric-video setting could change: all misses, and tier B hits when lyric videos are turned off. */
function onAllowLyric(on: boolean): void {
  let changed = false;
  for (const [s, e] of Object.entries(entries)) {
    if (overrides[s]) continue;
    if (!e.id || (!on && e.tier === 'B')) {
      delete entries[s];
      delete known[s];
      changed = true;
    }
  }
  if (changed) {
    persist();
    publish();
  }
}
let lastLyric = allowLyric();
useVideoSettings.subscribe((s) => {
  if (s.allowLyric !== lastLyric) {
    lastLyric = s.allowLyric;
    onAllowLyric(s.allowLyric);
  }
});

/** Test hook: forget in-memory state and reload from storage. */
export function _reloadForTests(): void {
  for (const k of Object.keys(entries)) delete entries[k];
  Object.assign(entries, loadEntries(getJson<Record<string, Entry>>(KEY)));
  migrateV3(entries);
  for (const k of Object.keys(overrides)) delete overrides[k];
  Object.assign(overrides, getJson<Record<string, string>>(OVERRIDE_KEY) ?? {});
  partialAt.clear();
  inflight.clear();
  unplayable.clear();
  seedKnown();
  publish();
}
