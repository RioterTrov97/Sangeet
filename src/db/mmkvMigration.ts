import { addHistory, setLiked, setSaved, type SavedItem } from './repo';
import type { Db } from './types';
import type { Track } from '../youtube/models';

export type KeyValue = { get<T>(key: string): T | undefined; remove(key: string): void };

const LIBRARY_KEY = 'library.v1';
const HISTORY_KEY = 'history.v1';

/**
 * One-time move of the MMKV library (likes, saved items, history) into SQLite. Idempotent: every insert is
 * insert-or-ignore, and the old keys are removed only after the whole copy succeeded. Returns what was imported.
 */
export function migrateFromMmkv(db: Db, kv: KeyValue): { liked: number; saved: number; history: number } {
  const lib = kv.get<{ liked?: Track[]; saved?: SavedItem[] }>(LIBRARY_KEY);
  const hist = kv.get<Track[]>(HISTORY_KEY);
  const out = { liked: 0, saved: 0, history: 0 };
  if (!lib && !hist) return out;
  const base = Date.now();
  // Lists were stored newest first; spread timestamps so the order survives.
  (lib?.liked ?? []).forEach((tr, i) => (setLiked(db, tr, true, 'local', base - i), out.liked++));
  (lib?.saved ?? []).forEach((it, i) => {
    setSaved(db, it, true, 'local', base - i);
    out.saved++;
  });
  const h = hist ?? [];
  for (let i = h.length - 1; i >= 0; i--) {
    addHistory(db, h[i], 'migrated', base - i * 1000);
    out.history++;
  }
  kv.remove(LIBRARY_KEY);
  kv.remove(HISTORY_KEY);
  return out;
}
