export type DropdownRow = { kind: 'recent' | 'suggestion' | 'typed'; text: string };

/** Rows in the search card: the latest recents with an empty field, more while typing. */
export const DROPDOWN_RECENT_ROWS = 3;
export const DROPDOWN_TYPED_ROWS = 5;

/**
 * Rows of the search dropdown. Empty field: the recent searches. Typing: the typed text first ("Search for <text>", unless a
 * suggestion already equals it), then the suggestions. Empty list means no dropdown.
 */
export function buildDropdownRows(input: string, recent: string[], suggestions: string[] | undefined, limit?: number): DropdownRow[] {
  const q = input.trim().replace(/\s+/g, ' ');
  if (!q) return recent.slice(0, limit ?? DROPDOWN_RECENT_ROWS).map((text) => ({ kind: 'recent', text }));
  const key = q.toLowerCase();
  const seen = new Set<string>();
  const rows: DropdownRow[] = [];
  const sug = (suggestions ?? []).filter((s) => {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!seen.has(key)) rows.push({ kind: 'typed', text: q });
  for (const text of sug) rows.push({ kind: 'suggestion', text });
  return rows.slice(0, limit ?? DROPDOWN_TYPED_ROWS);
}
