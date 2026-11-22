/**
 * Pure mapping from a Siri `INPlayMediaIntent` (as the native module serialises it) to an app action.
 * No React Native, no network: everything the decision needs comes in through `SiriContext`, so it is unit-testable.
 */
export type SiriMediaType = 'song' | 'album' | 'artist' | 'playlist' | 'genre' | 'station' | 'music' | 'unknown';

export type SiriIntentInput = {
  mediaName?: string;
  artistName?: string;
  albumName?: string;
  genreNames?: string[];
  moodNames?: string[];
  mediaType?: SiriMediaType;
  /** `currentlyPlaying` = "play more like this". `my` = "my music / my playlist". */
  reference?: 'currentlyPlaying' | 'my' | 'unknown';
  playShuffled?: boolean;
  repeat?: 'none' | 'all' | 'one';
  /** now (replace the queue), next (play next), later (add to the end). */
  queueLocation?: 'now' | 'next' | 'later';
};

export type PlaylistRef = { id: string; name: string; source: 'local' | 'yt' };

export type SiriContext = {
  playlists: PlaylistRef[];
  offline: boolean;
  hasCurrent: boolean;
  /** Names of downloaded albums/playlists/artists, used offline. */
  downloadedTitles?: string[];
  hasDownloads?: boolean;
  hasLiked?: boolean;
};

export type QueueMode = 'replace' | 'next' | 'later';

export type SiriAction =
  | { kind: 'playLiked'; shuffle: boolean; mode: QueueMode }
  | { kind: 'playDownloads'; shuffle: boolean; query?: string; mode: QueueMode }
  | { kind: 'playPlaylist'; playlist: PlaylistRef; shuffle: boolean; mode: QueueMode }
  | { kind: 'searchPlay'; query: string; searchType: 'song' | 'album' | 'artist'; radio: boolean; shuffle: boolean; mode: QueueMode }
  | { kind: 'browseMood'; query: string; shuffle: boolean; mode: QueueMode }
  | { kind: 'radioFromCurrent'; mode: QueueMode }
  | { kind: 'fail'; code: 'noMatch' | 'offline' | 'unsupported' };

export type SiriResultCode = 'success' | 'failure' | 'failureNoMatch' | 'failureOffline' | 'failureUnsupported';

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|my|playlist|songs|song|music|mix)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** 0..1 similarity between a spoken name and a candidate title. */
export function similarity(spoken: string, title: string): number {
  const a = normalize(spoken), b = normalize(title);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.4 + 0.6;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

export function bestPlaylist(spoken: string, playlists: PlaylistRef[], threshold = 0.72): PlaylistRef | undefined {
  let best: PlaylistRef | undefined;
  let score = 0;
  for (const p of playlists) {
    const s = similarity(spoken, p.name);
    // Prefer local over YT on equal scores (listed first).
    if (s > score) {
      score = s;
      best = p;
    }
  }
  return score >= threshold ? best : undefined;
}

const GENERIC = /^(something|anything|some music|music|songs|my music|my songs|liked songs|my liked songs|favou?rites|my favou?rites|something good|whatever)$/i;

/** True for "play music" / "play my liked songs" style requests that name nothing in particular. */
export const isGeneric = (name?: string) => !name || !name.trim() || GENERIC.test(name.trim());

export function mapIntent(input: SiriIntentInput, ctx: SiriContext): SiriAction {
  const mode: QueueMode = input.queueLocation === 'next' ? 'next' : input.queueLocation === 'later' ? 'later' : 'replace';
  const shuffle = !!input.playShuffled;
  const name = input.mediaName?.trim() || undefined;
  const artist = input.artistName?.trim() || undefined;
  const album = input.albumName?.trim() || undefined;
  const genre = input.genreNames?.[0] ?? input.moodNames?.[0];

  // "play more like this"
  if (input.reference === 'currentlyPlaying') return ctx.hasCurrent ? { kind: 'radioFromCurrent', mode } : { kind: 'fail', code: 'noMatch' };

  // Offline: only downloads can play.
  if (ctx.offline) {
    if (!ctx.hasDownloads) return { kind: 'fail', code: 'offline' };
    const q = [isGeneric(name) ? undefined : name, artist, album].filter(Boolean).join(' ') || undefined;
    return { kind: 'playDownloads', shuffle: shuffle || !q, query: q, mode };
  }

  // A playlist by name (spoken as a playlist, or just matching one of ours).
  if (name && !artist && !album && (input.mediaType === 'playlist' || input.mediaType === 'unknown' || input.mediaType === 'music' || input.mediaType === undefined || input.reference === 'my')) {
    const hit = bestPlaylist(name, ctx.playlists, input.mediaType === 'playlist' ? 0.6 : 0.8);
    if (hit) return { kind: 'playPlaylist', playlist: hit, shuffle, mode };
    if (input.mediaType === 'playlist') return { kind: 'searchPlay', query: name, searchType: 'song', radio: false, shuffle, mode };
  }

  // No name at all, or "my music": shuffle Liked.
  if (isGeneric(name) && !artist && !album && !genre) {
    if (input.reference === 'my' || !name || /liked|my|favou?rite/i.test(name ?? '')) return { kind: 'playLiked', shuffle: true, mode };
    return { kind: 'playLiked', shuffle: true, mode };
  }

  // Genre or mood.
  if (genre && !name && !artist && !album) return { kind: 'browseMood', query: genre, shuffle, mode };
  if ((input.mediaType === 'genre') && name) return { kind: 'browseMood', query: name, shuffle, mode };

  // Album (with or without artist).
  if (input.mediaType === 'album' || album) {
    return { kind: 'searchPlay', query: [album ?? name, artist].filter(Boolean).join(' '), searchType: 'album', radio: false, shuffle, mode };
  }

  // Artist only.
  if (artist && !name) return { kind: 'searchPlay', query: artist, searchType: 'artist', radio: true, shuffle, mode };
  if (input.mediaType === 'artist' && name) return { kind: 'searchPlay', query: name, searchType: 'artist', radio: true, shuffle, mode };

  // A song, optionally by an artist, then radio continuation.
  if (name) return { kind: 'searchPlay', query: [name, artist].filter(Boolean).join(' '), searchType: 'song', radio: true, shuffle, mode };

  return { kind: 'fail', code: 'unsupported' };
}

/** Which Siri result code the app reports for a finished action. */
export const resultFor = (ok: boolean, action: SiriAction): SiriResultCode =>
  ok ? 'success' : action.kind === 'fail' ? (action.code === 'offline' ? 'failureOffline' : action.code === 'unsupported' ? 'failureUnsupported' : 'failureNoMatch') : 'failureNoMatch';
