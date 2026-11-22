import type { Artwork, ArtistRef, VideoType } from '../models';

/** youtubei.js nodes are deeply dynamic; mappers read them defensively and never leak the types. */
export type YtNode = any;

export function textOf(t: YtNode): string {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  return typeof t.text === 'string' ? t.text : '';
}

export function parseDuration(text: string | undefined): number | undefined {
  if (!text || !/^\d+(:\d{1,2})+$/.test(text.trim())) return undefined;
  return text.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
}

export function artworkOf(thumb: YtNode): Artwork[] {
  const list: YtNode[] = Array.isArray(thumb) ? thumb : (thumb?.contents ?? []);
  return list
    .filter((t) => t?.url)
    .map((t) => ({ url: t.url as string, width: t.width, height: t.height }));
}

export function pageType(endpoint: YtNode): string | undefined {
  return endpoint?.payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
}

export function browseId(endpoint: YtNode): string | undefined {
  return endpoint?.payload?.browseId;
}

const ARTIST_PAGES = new Set(['MUSIC_PAGE_TYPE_ARTIST', 'MUSIC_PAGE_TYPE_USER_CHANNEL', 'MUSIC_PAGE_TYPE_LIBRARY_ARTIST']);

/** Splits text runs ("Artist, Artist & Artist") into artist refs using the runs' browse endpoints. */
export function artistsFromRuns(runs: YtNode[] | undefined): ArtistRef[] {
  return (runs ?? [])
    .filter((r) => ARTIST_PAGES.has(pageType(r.endpoint) ?? ''))
    .map((r) => ({ id: browseId(r.endpoint), name: r.text as string }));
}

export function artistsOf(list: YtNode[] | undefined): ArtistRef[] {
  return (list ?? []).filter((a) => a?.name).map((a) => ({ id: a.channel_id ?? browseId(a.endpoint), name: a.name as string }));
}

/** Picks the first run that links to an album page. */
export function albumFromRuns(runs: YtNode[] | undefined) {
  const r = (runs ?? []).find((x) => pageType(x.endpoint) === 'MUSIC_PAGE_TYPE_ALBUM');
  return r ? { id: browseId(r.endpoint) as string, name: r.text as string } : undefined;
}

export function isExplicit(badges: YtNode[] | undefined): boolean {
  return (badges ?? []).some((b) => b?.icon_type === 'MUSIC_EXPLICIT_BADGE');
}

const YTIMG = /^(https?:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/[\w-]+\/)(?:default|mqdefault|hqdefault|sddefault|maxresdefault)(\.\w+)(?:\?.*)?$/;

export function isYtimg(url: string): boolean {
  return YTIMG.test(url);
}

/** Names of the YouTube thumbnails that have letterbox bars (4:3 frames holding a 16:9 picture). */
export function hasLetterbox(url: string): boolean {
  return /\/(?:hqdefault|sddefault|default)\.\w+|-lb\.jpg$/.test(url); // -lb.jpg: a saved copy of one (downloads/autoCache)
}

/**
 * i.ytimg.com video thumbnails: mqdefault (320x180) is bar-free, maxresdefault (1280x720) is bar-free when it exists,
 * hqdefault/sddefault are 4:3 with bars. Picks the first for the pixel size wanted.
 */
export function ytimgUrl(url: string, px: number): string {
  const m = YTIMG.exec(url);
  if (!m) return url;
  const name = px <= 320 ? 'mqdefault' : 'maxresdefault';
  return `${m[1]}${name}${m[2]}`;
}

/** Fallbacks to try (in order) when a maxresdefault 404s: sddefault (cropped by the caller), then hqdefault. */
export function ytimgFallbacks(url: string): string[] {
  const m = YTIMG.exec(url);
  if (!m || !/\/maxresdefault\./.test(url)) return [];
  return [`${m[1]}sddefault${m[2]}`, `${m[1]}hqdefault${m[2]}`];
}

/** Upsizes googleusercontent thumbnails (...=w226-h226-...) to the requested square size; ytimg gets the right frame. */
export function sizedUrl(url: string, size: number): string {
  if (isYtimg(url)) return ytimgUrl(url, size);
  return url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`).replace(/=s\d+/, `=s${size}`);
}

const isSquareHost = (u: string) => /googleusercontent\.com|ggpht\.com/.test(u);

/** Artwork picker for UIs that want a URL near `size` px. Prefers the square YT Music (lh3/yt3) art over video frames. */
export function pickArtwork(art: Artwork[], size: number): string | undefined {
  const square = [...art].reverse().find((a) => isSquareHost(a.url));
  const pick = square ?? art[art.length - 1];
  return pick ? sizedUrl(pick.url, size) : undefined;
}

const VIDEO_TYPES: Record<string, VideoType> = {
  MUSIC_VIDEO_TYPE_ATV: 'song',
  MUSIC_VIDEO_TYPE_OMV: 'official',
  MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC: 'official',
  MUSIC_VIDEO_TYPE_UGC: 'ugc',
};

/** YouTube Music's musicVideoType for an item, found in its play/watch endpoints (shallow, bounded search). */
export function videoTypeOf(node: YtNode): VideoType | undefined {
  const seen = new Set<unknown>();
  const walk = (n: YtNode, depth: number): VideoType | undefined => {
    if (!n || typeof n !== 'object' || depth > 9 || seen.has(n)) return undefined;
    seen.add(n);
    const raw = n.musicVideoType ?? n.music_video_type;
    if (typeof raw === 'string' && VIDEO_TYPES[raw]) return VIDEO_TYPES[raw];
    for (const k of Object.keys(n)) {
      if (k === 'thumbnail' || k === 'thumbnails' || k === 'menu' || k === 'badges') continue;
      const v = walk(n[k], depth + 1);
      if (v) return v;
    }
    return undefined;
  };
  return walk(node, 0);
}

/** "1.2M views" / "345K views" / "1.2B views" / "1,234 views" -> number (undefined when it is not a view count). */
export function parseViews(text: string | undefined): number | undefined {
  const m = /^\s*([\d.,]+)\s*([KMB])?\s*views?\s*$/i.exec(text ?? '');
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, m[2] ? '.' : ''));
  if (!Number.isFinite(n)) return undefined;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(n * mult);
}
