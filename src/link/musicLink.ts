/**
 * YouTube Music links on the TV. The TV launcher catches `music.youtube.com` links and hands them over as
 * `sangeet://open?url=<link>`; a bare `music.youtube.com` / `youtube.com` / `youtu.be` link is understood too.
 * Pure parsing only (no React, no player), so it can be unit-tested; `openMusicLink.ts` plays the result.
 */
export type MusicLink =
  /**
   * A song (or music video). `list`: the playlist / album it was opened from, when the link says so. `at`: where to
   * start, in seconds (the link's `t=`).
   */
  | { kind: 'song'; videoId: string; list?: string; at?: number }
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string };

const HOSTS = new Set(['music.youtube.com', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const VIDEO = /^[\w-]{11}$/;
const ID = /^[\w-]{2,80}$/;

type Parts = { scheme: string; host: string; path: string; query: Map<string, string> };

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** scheme://host/path?query, without relying on a full URL implementation (Hermes' is partial). */
function split(url: string): Parts | null {
  const m = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?/i.exec(url.trim());
  if (!m) return null;
  const query = new Map<string, string>();
  for (const kv of (m[4] ?? '').split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    const k = decode(i < 0 ? kv : kv.slice(0, i));
    if (!query.has(k)) query.set(k, i < 0 ? '' : decode(kv.slice(i + 1)));
  }
  const host = (m[2] ?? '').replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase();
  return { scheme: m[1].toLowerCase(), host, path: m[3] ?? '', query };
}

/** True for the links this module is responsible for (so other `sangeet://` links keep their old handlers). */
export function isMusicLink(url: string | null | undefined): boolean {
  const p = url ? split(url) : null;
  if (!p) return false;
  if (p.scheme === 'sangeet') return p.host === 'open';
  return (p.scheme === 'https' || p.scheme === 'http') && HOSTS.has(p.host);
}

/** What a link points at, or null when it is not a playable YouTube Music link. */
export function parseMusicLink(url: string | null | undefined, depth = 0): MusicLink | null {
  const p = url ? split(url) : null;
  if (!p) return null;
  if (p.scheme === 'sangeet') {
    const inner = p.host === 'open' ? p.query.get('url') : undefined;
    return inner && depth === 0 ? parseMusicLink(inner, 1) : null;
  }
  if ((p.scheme !== 'https' && p.scheme !== 'http') || !HOSTS.has(p.host)) return null;
  const seg = p.path.split('/').filter(Boolean);
  const list = p.query.get('list');
  const okList = list && ID.test(list) ? list : undefined;
  const at = seconds(p.query.get('t') ?? p.query.get('start'));
  const song = (id: string | undefined): MusicLink | null => {
    if (!id || !VIDEO.test(id)) return okList ? playlistOrSong(okList) : null;
    const s: MusicLink = okList && !isRadio(okList) ? { kind: 'song', videoId: id, list: okList } : { kind: 'song', videoId: id };
    return at ? { ...s, at } : s;
  };
  if (p.host === 'youtu.be') return song(seg[0]);
  switch (seg[0]) {
    case 'watch':
      return song(p.query.get('v'));
    case 'playlist':
      return okList ? playlistOrSong(okList) : null;
    case 'browse':
      return browse(seg[1]);
    case 'channel':
      return seg[1] && /^UC[\w-]{10,}$/.test(seg[1]) ? { kind: 'artist', id: seg[1] } : null;
    default:
      return null;
  }
}

/** A link start time: `90`, `90s`, `1m30s`, `1h2m3s`. Undefined when absent, zero or unreadable. */
function seconds(t: string | undefined): number | undefined {
  const m = t ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t) : null;
  if (!m) return undefined;
  const n = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return n > 0 ? n : undefined;
}

/** Radio mixes ("RD...") are generated per listener: they cannot be loaded as a playlist. */
const isRadio = (list: string) => list.startsWith('RD');

/** A playlist id, except the song radio form `RDAMVM<videoId>`, which is that song (Sangeet continues it as radio itself). */
function playlistOrSong(list: string): MusicLink | null {
  const radio = /^RDAMVM([\w-]{11})$/.exec(list);
  if (radio) return { kind: 'song', videoId: radio[1] };
  return isRadio(list) ? null : { kind: 'playlist', id: list };
}

/** music.youtube.com/browse/<id>: VL<playlist>, MPREb_<album>, UC<artist channel>. Other pages (home, explore) are not playable. */
function browse(id: string | undefined): MusicLink | null {
  if (!id || !ID.test(id)) return null;
  if (id.startsWith('VL') && id.length > 4) return playlistOrSong(id.slice(2));
  if (id.startsWith('MPREb_')) return { kind: 'album', id };
  if (/^UC[\w-]{10,}$/.test(id)) return { kind: 'artist', id };
  return null;
}
