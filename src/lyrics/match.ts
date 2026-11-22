import type { Track } from '../youtube/models';
import { leadArtist, normalizeArtist, normalizeTitle, stripArtistPrefix } from './normalize';

/** Case and Latin-diacritics folded, punctuation and spaces removed (Devanagari etc. kept as is). */
export function foldKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s!-/:-@[-`{-~‘’“”–—…·]+/g, '');
}

/** The title forms to compare with: cleaned title, and without an "Artist - " prefix. */
export function titleKeys(track: Track): string[] {
  const artist = leadArtist(track.artists.map((a) => a.name).join(', '));
  const clean = normalizeTitle(track.title);
  return [...new Set([foldKey(clean), foldKey(stripArtistPrefix(clean, artist))].filter(Boolean))];
}

/** Equal after folding, or one contains the other (shorter at least 3 characters). */
export function titleMatches(candidate: string, keys: string[]): boolean {
  const c = foldKey(normalizeTitle(candidate));
  if (!c) return false;
  return keys.some((k) => k === c || (Math.min(k.length, c.length) >= 3 && (k.includes(c) || c.includes(k))));
}

/** The track's lead artist (or any of its artists) appears in the candidate's artist string. */
export function artistMatches(candidate: string, track: Track): boolean {
  const c = foldKey(candidate);
  if (!c) return false;
  const names = [leadArtist(track.artists.map((a) => a.name).join(', ')), ...track.artists.map((a) => normalizeArtist(a.name))];
  return names.map(foldKey).some((n) => n && (c.includes(n) || (c.length >= 3 && n.includes(c))));
}

export const STRICT_S = 2;
export const RELAXED_S = 5;

/** Closest-duration candidate within 2 s, else within 5 s; undefined when none (never "the closest"). Unknown playing length: first. */
export function pickByDuration<T extends { durationSec?: number }>(cands: T[], playingSec: number | undefined): T | undefined {
  if (!cands.length) return undefined;
  if (!playingSec) return cands[0];
  for (const tol of [STRICT_S, RELAXED_S]) {
    const ok = cands.filter((c) => c.durationSec != null && Math.abs(c.durationSec - playingSec) <= tol);
    if (ok.length) return ok.sort((a, b) => Math.abs(a.durationSec! - playingSec) - Math.abs(b.durationSec! - playingSec))[0];
  }
  return undefined;
}
