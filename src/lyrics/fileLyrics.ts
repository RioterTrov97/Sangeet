import { isTimed, parseLrc } from './lrc';
import type { Lyrics } from './types';

/**
 * Lyrics from the text of a `.lrc` file lying next to a song from this iPhone. Timed lines become synced lyrics (the file's
 * `[offset:]` is already applied by parseLrc); a file with no timestamps is shown as plain text. null for an empty file.
 */
export function lyricsFromLrcFile(text: string): Lyrics | null {
  const { lines, offsetMs } = parseLrc(text);
  if (isTimed(lines)) return { synced: lines, offsetMs: offsetMs || undefined, source: 'Lyrics file', providerId: 'file' };
  const plain = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\[(?:ar|ti|al|au|by|offset|length|re|ve):[^\]]*\]\s*$/i, '').trim())
    .filter(Boolean)
    .join('\n');
  return plain ? { plain, source: 'Lyrics file', providerId: 'file' } : null;
}
