export const RECENT_LIMIT = 20;

/** Adds `query` as the newest recent search: trimmed, case-insensitively deduped, capped. Empty queries are ignored. */
export function addRecent(list: string[], query: string, limit = RECENT_LIMIT): string[] {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return list;
  const key = q.toLowerCase();
  return [q, ...list.filter((r) => r.toLowerCase() !== key)].slice(0, limit);
}

export const removeRecent = (list: string[], query: string): string[] => list.filter((r) => r.toLowerCase() !== query.trim().toLowerCase());
