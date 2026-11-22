import { timed } from '../util/log';

/**
 * Minimal YouTube Music song search.
 *
 * Chosen approach: plain `fetch` against the WEB_REMIX InnerTube endpoint from React Native,
 * parsed by hand. youtubei.js's Music client would need Hermes polyfills (Event, CustomEvent,
 * ReadableStream, ...) and, from inside the WebView, music.youtube.com is cross-origin to
 * www.youtube.com (CORS). RN's native fetch has neither problem.
 */
export type SongResult = {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  thumbnail?: string;
};

const ENDPOINT =
  'https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const SONGS_FILTER = 'EgWKAQIIAWoSEAMQBBAJEA4QChAFEBEQEBAV';

type Json = any;

function* walk(o: Json): Generator<Json> {
  if (Array.isArray(o)) {
    for (const v of o) yield* walk(v);
  } else if (o && typeof o === 'object') {
    if (o.musicResponsiveListItemRenderer) yield o.musicResponsiveListItemRenderer;
    for (const v of Object.values(o)) yield* walk(v);
  }
}

function parseDuration(text: string): number {
  const parts = text.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function parseSearchResponse(json: Json): SongResult[] {
  const out: SongResult[] = [];
  for (const r of walk(json)) {
    const videoId = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId;
    const cols = r.flexColumns ?? [];
    const title = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
    const runs: { text: string }[] = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
    if (!videoId || !title) continue;
    const parts = runs.map((x) => x.text).filter((t) => t.trim() !== '•');
    // Typical layout: [Song?] Artist [, Artist...] Album Duration. Duration is the last part.
    const last = parts[parts.length - 1] ?? '';
    const hasDuration = /^\d+(:\d{2})+$/.test(last);
    const rest = hasDuration ? parts.slice(0, -1) : parts;
    const artist = rest[0] === 'Song' ? (rest[1] ?? '') : (rest[0] ?? '');
    const album = rest.length >= (rest[0] === 'Song' ? 3 : 2) ? rest[rest.length - 1] : '';
    const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
    const thumb: string | undefined = thumbs[thumbs.length - 1]?.url;
    out.push({
      videoId,
      title,
      artist,
      album,
      durationSec: hasDuration ? parseDuration(last) : 0,
      thumbnail: thumb?.replace(/=w\d+-h\d+/, '=w226-h226'),
    });
  }
  return out;
}

export async function searchSongs(query: string): Promise<SongResult[]> {
  return timed('search', `"${query}"`, async () => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' } },
        query,
        params: SONGS_FILTER,
      }),
    });
    if (!res.ok) throw new Error(`search HTTP ${res.status}`);
    return parseSearchResponse(await res.json());
  });
}
