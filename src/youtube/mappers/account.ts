import type { Shelf, Track } from '../models';
import { mapHome, mapPlaylistTracks } from './pages';
import { textOf, type YtNode } from './common';

/** Text of a raw JSON `{ runs }` / `{ simpleText }` value, or of a parsed `Text` node. */
function rawText(t: YtNode): string {
  if (typeof t?.simpleText === 'string') return t.simpleText;
  if (Array.isArray(t?.runs)) return t.runs.map((r: YtNode) => r?.text ?? '').join('');
  return textOf(t);
}

export type AccountInfo = { name: string; handle?: string; photo?: string };

/** First value stored under `key` anywhere in a JSON tree (depth-first). */
export function findKey(node: YtNode, key: string, depth = 0): YtNode {
  if (!node || typeof node !== 'object' || depth > 30) return undefined;
  if (key in node && node[key] != null) return node[key];
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const hit = findKey(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** The largest thumbnail URL of a `{ thumbnails: [{ url, width }] }` object (or a bare list). */
export function largestPhoto(photo: YtNode): string | undefined {
  const list: YtNode[] = (Array.isArray(photo) ? photo : photo?.thumbnails) ?? [];
  const sorted = list.filter((t) => typeof t?.url === 'string').sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  const best = sorted[0]?.url as string | undefined;
  if (!best) return undefined;
  return best.startsWith('//') ? `https:${best}` : best;
}

/** The signed-in account from the raw `/account/account_menu` JSON (`activeAccountHeaderRenderer`). Null when absent. */
export function parseAccountMenu(data: YtNode): AccountInfo | null {
  const h = findKey(data, 'activeAccountHeaderRenderer');
  if (!h) return null;
  const name = rawText(h.accountName).trim();
  if (!name) return null;
  const handle = rawText(h.channelHandle).trim() || undefined;
  const photo = largestPhoto(h.accountPhoto);
  return { name, ...(handle ? { handle } : {}), ...(photo ? { photo } : {}) };
}

/** Fallback shape: `yt.account.getInfo()` parsed (AccountItem-like with snake_case fields). */
export function parseAccountItem(item: YtNode): AccountInfo | null {
  const name = rawText(item?.account_name).trim();
  if (!name) return null;
  const handle = rawText(item?.channel_handle).trim() || undefined;
  const photo = largestPhoto(item?.account_photo);
  return { name, ...(handle ? { handle } : {}), ...(photo ? { photo } : {}) };
}

/** Every music shelf's tracks in page order (Today, Yesterday, ...), deduped by id and capped. */
export function flattenHistory(shelves: YtNode[] | undefined, cap = 100): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const shelf of shelves ?? []) {
    for (const t of mapPlaylistTracks(shelf?.contents)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

export type RecapPage = { title?: string; subtitle?: string; artwork?: string; shelves: Shelf[] };

/** Recap header + carousel shelves. Null when the page is a message ("not available") or has nothing to show. */
export function mapRecap(recap: YtNode): RecapPage | null {
  const sections: YtNode[] = recap?.sections ?? [];
  const carousels = sections.filter((s) => s && !s.message && s.type !== 'Message' && Array.isArray(s.contents));
  const shelves = mapHome({ sections: carousels });
  const h = recap?.header;
  const title = textOf(h?.title) || undefined;
  const subtitle = textOf(h?.subtitle) || textOf(h?.strapline) || undefined;
  const thumbs: YtNode[] = h?.thumbnail?.contents ?? h?.thumbnail?.thumbnails ?? [];
  const artwork = typeof thumbs[0]?.url === 'string' ? (thumbs[0].url as string) : undefined;
  if (!shelves.length && !title) return null;
  return { title, subtitle, artwork, shelves };
}
