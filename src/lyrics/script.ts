import type { Track } from '../youtube/models';
import type { Lyrics } from './types';

const DEVANAGARI = /[ऀ-ॿ]/g;
const LETTER = /[A-Za-zऀ-ॿঀ-෿一-鿿]/g;

/** Share of Devanagari among the letters of `text` (0 when there are none). */
export function devanagariShare(text: string): number {
  const letters = text.match(LETTER)?.length ?? 0;
  return letters ? (text.match(DEVANAGARI)?.length ?? 0) / letters : 0;
}

/** Mostly Devanagari lyrics (Hindi, Nepali, Marathi in native script). */
export function isDevanagari(l: Lyrics): boolean {
  const text = l.synced?.length ? l.synced.map((x) => x.text).join('\n') : (l.plain ?? '');
  return devanagariShare(text) >= 0.5;
}

/** The title or an artist is written in Devanagari: native-script lyrics are expected. */
export const looksDevanagari = (t: Track): boolean => /[\u0900-\u097f]/.test(`${t.title} ${t.artists.map((a) => a.name).join(' ')}`);
