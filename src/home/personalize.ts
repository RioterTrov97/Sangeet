import type { Album, Artist, ArtistPage, MusicItem, Track } from '../youtube/models';

/** On-device personalisation. Pure functions over the local play history (nothing here touches the network). */
export type Play = { track: Track; playedAt: number };

export const MIN_PLAYS = 5;
export const WINDOW_DAYS = 30;
const DAY = 86_400_000;

const primaryArtist = (t: Track) => t.artists.find((a) => a.id);

export const isPersonalised = (plays: Play[], min = MIN_PLAYS) => plays.length >= min;

const inWindow = (plays: Play[], now: number, days: number) => plays.filter((p) => now - p.playedAt <= days * DAY);

export type TopArtist = { id: string; name: string; count: number; lastPlayedAt: number; topTrack: Track };

/** Artists ranked by play count in the window (ties: most recently played first). `topTrack` is their most-played track. */
export function topArtists(plays: Play[], now: number, limit = 10, days = WINDOW_DAYS): TopArtist[] {
  const by = new Map<string, { id: string; name: string; count: number; last: number; tracks: Map<string, { t: Track; n: number }> }>();
  for (const p of inWindow(plays, now, days)) {
    const a = primaryArtist(p.track);
    if (!a?.id) continue;
    const e = by.get(a.id) ?? { id: a.id, name: a.name, count: 0, last: 0, tracks: new Map() };
    e.count++;
    e.last = Math.max(e.last, p.playedAt);
    const tr = e.tracks.get(p.track.id) ?? { t: p.track, n: 0 };
    tr.n++;
    e.tracks.set(p.track.id, tr);
    by.set(a.id, e);
  }
  return [...by.values()]
    .sort((x, y) => y.count - x.count || y.last - x.last)
    .slice(0, limit)
    .map((e) => ({ id: e.id, name: e.name, count: e.count, lastPlayedAt: e.last, topTrack: [...e.tracks.values()].sort((a, b) => b.n - a.n)[0].t }));
}

/** Seeds for "Because you listened to ...": most-played tracks in the window, one per artist, ties by recency. */
export function pickSeeds(plays: Play[], now: number, n = 2, days = WINDOW_DAYS): Track[] {
  const by = new Map<string, { t: Track; n: number; last: number }>();
  for (const p of inWindow(plays, now, days)) {
    const e = by.get(p.track.id) ?? { t: p.track, n: 0, last: 0 };
    e.n++;
    e.last = Math.max(e.last, p.playedAt);
    by.set(p.track.id, e);
  }
  const seenArtists = new Set<string>();
  const out: Track[] = [];
  for (const e of [...by.values()].sort((a, b) => b.n - a.n || b.last - a.last)) {
    const key = primaryArtist(e.t)?.id ?? e.t.id;
    if (seenArtists.has(key)) continue;
    seenArtists.add(key);
    out.push(e.t);
    if (out.length >= n) break;
  }
  return out;
}

/** Top artists as Artist cards. */
export const artistCards = (top: TopArtist[]): Artist[] => top.map((a) => ({ kind: 'artist', id: a.id, name: a.name, artwork: a.topTrack.artwork }));

/** Followed artists first, then top-played ones (deduped by id). */
export function mergeArtists(followed: Artist[], top: TopArtist[]): Artist[] {
  const seen = new Set<string>();
  return [...followed, ...artistCards(top)].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

/** Artist ids the user is known to like: followed artists, liked-song artists plus their top-3 played artists. */
export function affinityArtistIds(liked: Track[], top: TopArtist[], followed: Artist[] = []): Set<string> {
  const ids = new Set<string>();
  for (const a of followed) ids.add(a.id);
  for (const t of liked) for (const a of t.artists) if (a.id) ids.add(a.id);
  for (const a of top.slice(0, 3)) ids.add(a.id);
  return ids;
}

const yearOf = (a: Album) => Number(a.year) || 0;

/** An artist's newest releases (albums + singles, by year desc; the page order breaks ties), at most `per`. */
export function latestReleases(page: Pick<ArtistPage, 'albums' | 'singles'>, per = 2): Album[] {
  const all = [...page.singles, ...page.albums];
  return all
    .map((a, i) => ({ a, i }))
    .sort((x, y) => yearOf(y.a) - yearOf(x.a) || x.i - y.i)
    .slice(0, per)
    .map((x) => x.a);
}

/** "New from artists you follow": each artist's latest releases, interleaved newest-year first, only from `minYear` on. */
export function newFromFollowed(perArtist: Album[][], minYear: number, max = 15): Album[] {
  const seen = new Set<string>();
  return perArtist
    .flatMap((list, ai) => list.map((a, i) => ({ a, k: i * 1000 + ai })))
    .filter(({ a }) => yearOf(a) >= minYear)
    .sort((x, y) => yearOf(y.a) - yearOf(x.a) || x.k - y.k)
    .map((x) => x.a)
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .slice(0, max);
}

const itemArtistIds = (i: MusicItem): string[] => {
  if (i.kind === 'track' || i.kind === 'album') return i.artists.flatMap((a) => (a.id ? [a.id] : []));
  if (i.kind === 'artist') return [i.id];
  return [];
};

/** Lightly boosts items by liked artists to the front: at most `max` are promoted (stable order otherwise). */
export function boostLiked<T extends MusicItem>(items: T[], liked: Set<string>, max = 3): T[] {
  if (!liked.size) return items;
  const boosted = items.filter((i) => itemArtistIds(i).some((id) => liked.has(id))).slice(0, max);
  const set = new Set(boosted);
  return [...boosted, ...items.filter((i) => !set.has(i))];
}

/** Drops the seed and anything already in recent history from a radio list. */
export const freshOnly = (list: Track[], seedId: string, recent: Track[], max = 15): Track[] => {
  const skip = new Set([seedId, ...recent.map((t) => t.id)]);
  return list.filter((t) => !skip.has(t.id)).slice(0, max);
};
