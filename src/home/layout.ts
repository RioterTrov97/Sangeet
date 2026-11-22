import type { Album, MusicItem, Playlist, Shelf, Track } from '../youtube/models';

/** Pure helpers behind the Home layout: quick-pick mixing, shelf merging and cross-shelf de-duplication. */

export const itemKey = (i: MusicItem): string => `${i.kind}-${i.id}`;

/** First occurrence wins; items without artwork are skipped when `needArt`. */
export function uniqueItems<T extends MusicItem>(items: T[], needArt = false): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = itemKey(i);
    if (seen.has(k) || (needArt && !i.artwork.length)) return false;
    seen.add(k);
    return true;
  });
}

export const isQuickPicksTitle = (title: string) => /quick picks/i.test(title);

/** Items of the YT Music "Quick picks" shelf, if the feed has one. */
export function ytQuickPicks(feed: Shelf[] | undefined): MusicItem[] {
  return feed?.find((s) => isQuickPicksTitle(s.title) && s.items.length)?.items ?? [];
}

export type QuickInput = {
  /** YT Music "Quick picks" shelf items. */
  yt: MusicItem[];
  /** Fallback when the feed has no Quick picks (trending songs / videos). */
  trending: MusicItem[];
  personalised: boolean;
  recent: Track[];
  top: Track[];
  followed: MusicItem[];
  /** Keys to steer away from (e.g. the Top songs rows) when enough other items exist. */
  avoid?: Set<string>;
  /** Signed in: the account's own YT Quick picks lead (all of them, up to 20); local recent only fills gaps. */
  signedIn?: boolean;
  max?: number;
};

/** 6-8 quick-pick tiles. Default: YT Quick picks (else trending). Personalised: interleave recent / top / followed / YT, deduped. */
export function mixQuickPicks({ yt, trending, personalised, recent, top, followed, avoid, signedIn, max }: QuickInput): MusicItem[] {
  if (signedIn && yt.length) return uniqueItems([...yt, ...recent], true).slice(0, max ?? 20);
  max ??= 8;
  const base = yt.length ? yt : trending;
  const lists: MusicItem[][] = personalised ? [recent.slice(0, 6), top, followed, base] : [base, trending];
  const pool: MusicItem[] = [];
  for (let i = 0; pool.length < 200 && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) pool.push(l[i]);
  const all = uniqueItems(pool, true);
  const fresh = avoid?.size ? all.filter((i) => !avoid.has(itemKey(i))) : all;
  const picks = fresh.length >= Math.min(6, max) ? fresh : [...fresh, ...all.filter((i) => !fresh.includes(i))];
  return picks.slice(0, max);
}

const yearOf = (a: Album) => Number(a.year) || 0;

/** Albums + singles as one list, newest year first (alternating kinds on ties), capped. */
export function mergeReleases(albums: Album[], singles: Album[], max = 10): Album[] {
  const mixed: Album[] = [];
  for (let i = 0; i < Math.max(albums.length, singles.length); i++) {
    if (albums[i]) mixed.push(albums[i]);
    if (singles[i]) mixed.push(singles[i]);
  }
  return uniqueItems(mixed)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => yearOf(y.a) - yearOf(x.a) || x.i - y.i)
    .slice(0, max)
    .map((x) => x.a);
}

/**
 * Removes items already claimed (`seen`) from a shelf, then claims what remains. If fewer than `min` would be left the
 * shelf keeps its original items instead ("where avoidable"). Returns [] for an empty shelf.
 */
export function dedupeInto<T extends MusicItem>(items: T[], seen: Set<string>, { min = 3, max = 10 }: { min?: number; max?: number } = {}): T[] {
  const own = uniqueItems(items);
  const filtered = own.filter((i) => !seen.has(itemKey(i)));
  const out = (filtered.length >= Math.min(min, own.length) ? filtered : own).slice(0, max);
  for (const i of out) seen.add(itemKey(i));
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const OWN_TITLES = [/quick picks/, /^(top|trending) (songs|music|videos)/, /^new (releases|singles|albums)/, /^(trending|popular)\b/, /^recently played/, /^your (top )?artists/, /^mixes? for you/, /^top (playlists|charts)/];

/** YT feed shelves worth showing: non-empty, not duplicating one of ours (Quick picks / Trending / ...), items already seen dropped. */
export function filterFeed(feed: Shelf[], seen: Set<string>, ownTitles: string[] = []): Shelf[] {
  const own = new Set(ownTitles.map(norm));
  const titles = new Set<string>();
  const out: Shelf[] = [];
  for (const s of feed) {
    const t = norm(s.title);
    if (!s.items.length || own.has(t) || titles.has(t) || OWN_TITLES.some((re) => re.test(t))) continue;
    titles.add(t);
    const items = dedupeInto(s.items, seen, { min: 3 });
    if (items.length) out.push({ title: s.title, items });
  }
  return out;
}

export type HomeRowId = 'quick' | 'supermix' | 'account' | 'library' | 'recent' | 'because' | 'topSongs' | 'followedNew' | 'artists' | 'mixes' | 'newReleases' | 'videos' | 'popularArtists' | 'charts' | 'mood' | 'feed';

/** Account (signed-in) shelves: YouTube's own feed shelves in its order, plus which of our sections they replace. */
export type AccountFeed = { shelves: Shelf[]; hideMixes: boolean; hideRecent: boolean };

/**
 * Signed-in feed shelves: the primary content, so only empty shelves, Quick picks and exact duplicate titles are dropped
 * (no dedupe against our own rows). A mix shelf hides our "Mixes for you"; a Listen again / Recently played shelf hides our Recently played.
 */
export function accountFeed(feed: Shelf[]): AccountFeed {
  const titles = new Set<string>();
  const shelves: Shelf[] = [];
  for (const s of feed) {
    const t = norm(s.title);
    if (!s.items.length || isQuickPicksTitle(s.title) || titles.has(t)) continue;
    titles.add(t);
    shelves.push({ title: s.title, items: uniqueItems(s.items) });
  }
  return { shelves, hideMixes: shelves.some((s) => /mix/i.test(s.title)), hideRecent: shelves.some((s) => /listen again|recently played/i.test(s.title)) };
}

/** The playlist behind the "Your Supermix" button: a playlist titled Supermix, else the first playlist of a "Mixed for you" shelf. */
export function findSupermix(feed: Shelf[]): Playlist | undefined {
  const playlists = (s: Shelf) => s.items.filter((i): i is Playlist => i.kind === 'playlist');
  const direct = feed.flatMap(playlists).find((p) => /supermix/i.test(p.title));
  return direct ?? feed.filter((s) => /mix(ed)? for you/i.test(s.title)).flatMap(playlists)[0];
}

/** Section order. Personalised: quick picks, recent, because, top songs, followed new, artists, mixes, then the shared tail. Signed in: quick picks, supermix, the artist picker card, account shelves, then our personal rows, then the tail minus the feed. */
export function homeOrder(personalised: boolean, followed: boolean, signedIn = false): HomeRowId[] {
  const tail: HomeRowId[] = ['newReleases', 'videos', 'popularArtists', 'charts', 'mood'];
  if (signedIn) return ['quick', 'supermix', 'account', 'recent', 'because', 'library', ...(followed ? (['followedNew'] as const) : []), 'artists', 'mixes', 'topSongs', ...tail]; // topSongs shows on Discover
  if (personalised) return ['quick', 'recent', 'because', 'topSongs', ...(followed ? (['followedNew'] as const) : []), 'artists', 'mixes', ...tail, 'feed'];
  return ['quick', 'topSongs', ...(followed ? (['followedNew', 'artists'] as const) : []), ...tail, 'feed'];
}
