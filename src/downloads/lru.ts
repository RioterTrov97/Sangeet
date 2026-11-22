export type StoredItem = { trackId: string; bytes: number; pinned: boolean; lastPlayedAt: number; updatedAt: number };

/**
 * Which downloads to delete to get under `limitBytes` (0 = unlimited). Only non-pinned items are candidates, least
 * recently played first. `protect` ids (now playing / queued next) are never removed.
 */
export function planEviction(items: StoredItem[], limitBytes: number, protect: ReadonlySet<string> = new Set()): string[] {
  if (!limitBytes) return [];
  let total = items.reduce((n, i) => n + i.bytes, 0);
  if (total <= limitBytes) return [];
  const candidates = items.filter((i) => !i.pinned && !protect.has(i.trackId)).sort((a, b) => (a.lastPlayedAt || a.updatedAt) - (b.lastPlayedAt || b.updatedAt));
  const out: string[] = [];
  for (const c of candidates) {
    if (total <= limitBytes) break;
    out.push(c.trackId);
    total -= c.bytes;
  }
  return out;
}

export const LIMIT_OPTIONS_GB = [1, 2, 5, 10, 0] as const;
export const gbToBytes = (gb: number) => gb * 1024 ** 3;
