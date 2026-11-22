/**
 * Song -> music video matcher: scores candidates from YouTube Music "Videos" search, plain YouTube search and `/next`
 * and sorts them into tiers (A music video, B lyric video / official audio, C everything else that fits the title and length).
 * Pure: no network, no React Native.
 */
import type { ArtistRef } from '../youtube/models';
import { normalizeArtist, normalizeTitle, romanSkeleton } from '../lyrics/normalize';
import { channelIsArtist } from './logic';

/** Bump when scoring changes enough that cached non-tier-A answers should be recomputed. */
export const MATCHER_VERSION = 4;

/** 'plain' = checked through `/next` and carries no YouTube Music label (a normal upload). */
export type VideoKind = 'official' | 'ugc' | 'song' | 'plain';

export type VideoCandidate = {
  id: string;
  title: string;
  /** Uploading channel. After a merge `name` can hold several names joined with ", ". */
  channel?: { id?: string; name: string; verified?: boolean };
  durationSec?: number;
  views?: number;
  videoType?: VideoKind;
  /** YouTube Music's artist list for the video (search rows, `/next`). */
  artists?: ArtistRef[];
  source: 'ytm' | 'web' | 'next';
  /** Other titles this video had in the pools that were merged; the best-matching one is used for scoring. */
  altTitles?: string[];
};

export type VideoTier = 'A' | 'B' | 'C';
export type Scored = VideoCandidate & { score: number; tier: VideoTier; needsVerify: boolean };

/** The song side. `album` may be the album name or an album ref. */
export type MatchSong = {
  id?: string;
  title: string;
  artists: ArtistRef[];
  durationSec?: number;
  album?: string | { name: string };
};

export type RankOptions = {
  /** Accept tier B (lyric video / visualiser / official audio) as `best` when there is no tier A. */
  allowLyric?: boolean;
};

// ---------- text helpers ----------
const strip = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const compact = (s: string) => strip(s).replace(/[^\p{L}\p{N}]+/gu, '');
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'feat', 'ft', 'from', 'official', 'video', 'song', 'movie', 'new', 'nepali', 'hindi', 'full', 'hd', '4k', 'music', 'lyrical', 'lyrics', 'lyric', 'audio']);
const toks = (s: string) => strip(s).split(/[^\p{L}\p{N}]+/u).filter((t) => t && !STOP.has(t));

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length + b.length - 2);
}

function lev(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

const tokEq = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a) || lev(a, b) <= 1));

/** Share of the first token list that appears (fuzzily) in the second. */
function frac(a: string[], b: string[]): number {
  if (!a.length) return 0;
  let n = 0;
  for (const t of a) if (b.some((c) => tokEq(t, c))) n++;
  return n / a.length;
}

/**
 * Title similarity 0..1: token coverage both ways, compact bigram Dice on the head of the candidate title, and the
 * romanisation skeleton. The video side is compared on every `|` / ` - ` segment ("Tere Vaaste | Zara Hatke Zara Bachke").
 */
export function titleSim(songTitle: string, candTitle: string): number {
  const st = normalizeTitle(songTitle).replace(/\(.*?\)/g, ' ').replace(/\s[-–]\s.*$/, ''); // drop "(feat ..)", "- X" tails
  const norm = normalizeTitle(candTitle);
  const segs = [norm.split(/\s[-–—]\s|[|]|\(|\[/)[0], ...candTitle.split(/\s*[|\-–—]\s*/).map((x) => x.replace(/[([].*$/, ''))].filter((x) => toks(x).length);
  const s = toks(st);
  const cAll = toks(norm);
  const cs = compact(norm);
  const contains = compact(st).length >= 3 && cs.includes(compact(st)) ? 1 : 0;
  let best = Math.max(contains, frac(s, cAll));
  for (const head of segs) {
    const cHead = toks(head);
    const d = dice(compact(st), compact(head));
    const b = cHead.length ? frac(cHead, s) : 0;
    const k1 = romanSkeleton(st);
    const k2 = romanSkeleton(head);
    const sk = k1.length >= 4 && k2.length >= 4 ? dice(k1, k2) : 0;
    best = Math.max(best, Math.min(b, d + 0.15), d > 0.8 ? d : 0, sk >= 0.85 ? sk * 0.9 : 0);
  }
  return best;
}

// ---------- marker words ----------
const BAD = /\b(live|cover|covered|karaoke|reaction|remix|slowed|sped|reverb|lofi|lo-fi|instrumental|8d|nightcore|tribute|acoustic|unplugged|amv|gmv|fan ?made|mashup|piano|guitar|violin|bass ?boosted|1 ?hour|loop|tutorial|lesson|parody|jukebox|collection|nonstop|dj|performance|performing|behind the scenes|making of|teaser|trailer|status|shorts|dance|choreography|concert|cover version|session|mix|flip|remake|reprise|edit|version 2)\b/;
const LYRIC = /\b(lyrics?|lyrical|lyric video|visuali[sz]er|official audio|audio|full audio|art ?track|with lyrics)\b/;
const OFFICIALWORD = /\b(official|full video|video song|full song|music video|mv|m\/v)\b/;

/**
 * True when the candidate title carries a "not the real video" marker (live, cover, remix, lofi, making of ...).
 * A song that is itself such a derivative only matches a candidate carrying the same marker(s).
 */
export function hasBadMarker(songTitle: string, candTitle: string): boolean {
  const sTitle = songTitle.toLowerCase();
  const raw = candTitle.toLowerCase();
  if (BAD.test(sTitle)) {
    const marks = [...new Set(sTitle.match(new RegExp(BAD.source, 'g')) ?? [])];
    return !marks.every((m) => raw.includes(m));
  }
  return BAD.test(raw.replace(normalizeTitle(songTitle).toLowerCase(), ''));
}

/**
 * Duration factor for a candidate that is `d` seconds longer than the song: 1 within -8..+90 s (videos add intros), 0.6 up to +130,
 * 0.5 down to -20, and 0.6 for -140..+130 only when the video is official/verified with >= 2 M views (film cuts). 0 = reject.
 */
export function durationFactor(d: number, strongOfficial = false): number {
  if (d >= -8 && d <= 90) return 1;
  if (d > 90 && d <= 130) return 0.6;
  if (d >= -20 && d < -8) return 0.5;
  if (strongOfficial && d >= -140 && d <= 130) return 0.6;
  return 0;
}

// ---------- merging ----------
/** Merge pools by video id: keeps the YouTube Music type, the verified flag, the larger view count and the artist list. */
export function mergeCandidates(pools: VideoCandidate[][]): VideoCandidate[] {
  const seen = new Map<string, VideoCandidate>();
  for (const pool of pools) {
    for (const c of pool) {
      const prev = seen.get(c.id);
      if (!prev) {
        seen.set(c.id, { ...c });
        continue;
      }
      const names = [...new Set([...(prev.channel?.name ?? '').split(', '), ...(c.channel?.name ?? '').split(', ')].filter(Boolean))];
      const verified = !!prev.channel?.verified || !!c.channel?.verified;
      const alt = [...(prev.altTitles ?? []), ...(c.title !== prev.title ? [c.title] : [])].filter((t) => t !== prev.title);
      const views = Math.max(prev.views ?? 0, c.views ?? 0);
      const artists = prev.artists?.length ? prev.artists : c.artists;
      const merged: VideoCandidate = {
        ...prev,
        channel: names.length ? { id: prev.channel?.id ?? c.channel?.id, name: names.join(', '), ...(verified ? { verified } : {}) } : prev.channel,
        durationSec: prev.durationSec ?? c.durationSec,
        views: views || undefined,
        videoType: prev.videoType ?? c.videoType,
        artists,
        altTitles: alt.length ? [...new Set(alt)] : undefined,
      };
      if (merged.videoType === undefined) delete merged.videoType;
      seen.set(c.id, merged);
    }
  }
  return [...seen.values()];
}

// ---------- scoring ----------
type Parts = { s: number; t: number; art: number; own: boolean; ctx: number; dur: number; pop: number; official: number; kind: 'bad' | 'lyric' | 'video'; title: string };

const T_A = 0.62;
const T_B = 0.5;
const TITLE_GATE = 0.7;

const albumName = (song: MatchSong) => (typeof song.album === 'string' ? song.album : song.album?.name);

function scoreOne(song: MatchSong, c: VideoCandidate): Parts {
  const names = song.artists.map((a) => normalizeArtist(a.name)).filter(Boolean);
  const sTitle = song.title.toLowerCase();
  // Merged candidates: use the title that matches the song best.
  let title = c.title;
  let t = titleSim(song.title, c.title);
  for (const alt of c.altTitles ?? []) {
    const x = titleSim(song.title, alt);
    if (x > t) {
      t = x;
      title = alt;
    }
  }
  const raw = title.toLowerCase();
  const rawNoTitle = raw.replace(normalizeTitle(song.title).toLowerCase(), '');
  const songLyric = LYRIC.test(sTitle);
  const bad = hasBadMarker(song.title, title);
  const isLyric = !songLyric && LYRIC.test(rawNoTitle);
  const chNames = (c.channel?.name ?? '').split(', ');
  const own = names.some((n) => channelIsArtist(chNames.map((x) => ({ name: x })), n, normalizeArtist) || (compact(n).length >= 4 && chNames.some((x) => compact(x).includes(compact(n)))));
  const inTitle = names.some((n) => compact(n).length >= 3 && compact(title).includes(compact(n)));
  const album = albumName(song);
  const parens = (song.title.match(/[(\[]([^)\]]*)[)\]]/g) ?? []).filter((p) => !/feat|ft\./i.test(p)).join(' ');
  const ctxToks = [...new Set([...toks(parens), ...toks(album && compact(album) !== compact(normalizeTitle(song.title)) ? album : '')])].filter((x) => x.length >= 4 && !/^(from|version|original|motion|picture|soundtrack|film)$/.test(x));
  const ctx = ctxToks.length && ctxToks.some((x) => toks(title).includes(x)) ? 0.7 : 0;
  const art = own ? 1 : inTitle ? 0.8 : 0;
  const songSec = song.durationSec ?? 0;
  const d = (c.durationSec ?? songSec) - songSec;
  const views = c.views ?? 0;
  const verified = !!c.channel?.verified || c.videoType === 'official';
  const strong = verified && views >= 2_000_000;
  const dur = durationFactor(d, strong);
  const pop = views <= 0 ? 0 : Math.min(1, Math.max(0, (Math.log10(views) - 4) / 4)); // 10k -> 0, 100M -> 1
  const official = c.videoType === 'official' ? 1 : verified ? 0.6 : c.videoType === 'ugc' ? 0 : 0.2;
  const kind = bad ? 'bad' : isLyric ? 'lyric' : 'video';
  const s = 0.34 * t + 0.22 * art + 0.14 * dur + 0.12 * official + 0.18 * pop + (OFFICIALWORD.test(raw) ? 0.03 : 0);
  return { s, t, art, own, ctx, dur, pop, official, kind, title };
}

/** Names the song is credited to: its artists plus "(feat. X & Y)" credits in the title. */
function wantedArtists(song: MatchSong): string[] {
  const feat = (song.title.match(/(?:feat\.?|ft\.?|with)\s+([^)\]]+)/i)?.[1] ?? '').split(/\s*(?:,|&|and)\s*/).filter(Boolean);
  return [...song.artists.map((a) => a.name), ...feat].map((x) => compact(normalizeArtist(x)));
}

/** True when one of `names` is (or contains / is contained in) one of the song's credited artists. */
export function artistOverlap(song: MatchSong, names: string[]): boolean {
  const want = wantedArtists(song);
  return names.map((n) => compact(normalizeArtist(n))).some((n) => n.length >= 3 && want.some((w) => w.length >= 3 && (n === w || n.includes(w) || w.includes(n))));
}

const TIER_ORDER: Record<VideoTier, number> = { A: 0, B: 1, C: 2 };

/**
 * Scores and tiers the candidates (already merged, see `mergeCandidates`). `ranked` holds every candidate that passed the title and
 * duration gates, tier A first, then B, then C, best score first. `best` is the top tier A (or the top tier B when `allowLyric`).
 * `needsVerify` marks a pick whose YouTube Music type or artist list is still unknown (plain-YouTube-only): look it up with `/next`,
 * merge the result in (`videoType`, `artists`) and rank again.
 */
export function rankVideoCandidates(song: MatchSong, candidates: VideoCandidate[], opts: RankOptions = {}): { ranked: Scored[]; best?: Scored } {
  const rows = candidates
    .filter((c) => c.id !== song.id && c.videoType !== 'song')
    .map((c) => ({ c, p: scoreOne(song, c) }))
    .filter(({ p }) => p.t >= TITLE_GATE && p.dur > 0 && p.kind !== 'bad');
  // Popularity dominance among same-title candidates: the clip nobody watched is probably a re-upload.
  const vids = rows.filter(({ p }) => p.kind === 'video');
  const topOthers = (x: (typeof rows)[number]) => Math.max(0, ...vids.filter((y) => y !== x).map((y) => y.c.views ?? 0));
  const out: Scored[] = rows.map((r) => {
    const { c, p } = r;
    let tier: VideoTier = 'C';
    let needsVerify = false;
    // A pick with none of "channel is the artist / artist in the title / context" must share a name with the song's artists in YouTube Music's artist list.
    const artistCheck = (): 'ok' | 'unknown' | 'fail' => {
      if (p.own || p.art >= 0.8 || p.ctx >= 0.7) return 'ok';
      const names = [...(c.channel?.name ?? '').split(', '), ...(c.artists ?? []).map((a) => a.name)].filter(Boolean);
      if (artistOverlap(song, names)) return 'ok';
      return !c.artists?.length && c.videoType === undefined ? 'unknown' : 'fail';
    };
    if (p.kind === 'video') {
      const dominant = p.t >= 0.9 && p.pop >= 0.6 && (c.views ?? 0) >= 10 * topOthers(r);
      const gate = p.s >= T_A - (dominant ? 0.05 : 0) && (p.own || (p.official >= 0.6 && (p.art >= 0.8 || p.pop >= 0.45)) || (p.art >= 0.8 && p.pop >= 0.5) || dominant);
      // Someone else's upload of the real video (a verified tick is not ownership) stays a picker candidate unless it is popular and names the artist.
      const thirdParty = !p.own && c.videoType !== 'official' && p.ctx < 0.7 && !dominant && !(p.art >= 0.8 && (c.views ?? 0) >= 1_000_000);
      const check = gate && !thirdParty ? artistCheck() : 'fail';
      if (check !== 'fail') tier = 'A';
      needsVerify = tier === 'A' && (check === 'unknown' || c.videoType === undefined);
    } else if (p.kind === 'lyric' && p.s >= T_B && (p.own || p.official >= 0.6 || (p.art >= 0.8 && p.pop >= 0.5))) {
      const check = artistCheck();
      if (check !== 'fail') tier = 'B';
      needsVerify = tier === 'B' && (check === 'unknown' || c.videoType === undefined);
    }
    return { ...c, title: p.title, altTitles: undefined, score: p.s, tier, needsVerify };
  });
  out.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.score - a.score);
  const best = out.find((x) => x.tier === 'A') ?? (opts.allowLyric ? out.find((x) => x.tier === 'B') : undefined);
  return { ranked: out, best };
}
