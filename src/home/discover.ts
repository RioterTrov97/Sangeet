import type { Mood } from '../youtube/api';
import type { Playlist, Shelf } from '../youtube/models';

/** Mood pages always offered on Home (the first matching tiles, in this order). */
export const MOOD_TITLES = ['Chill', 'Workout', 'Party'] as const;

/** A genre tile that suits the device region, when the Moods & genres page has one (title regexes). */
const REGION_GENRE: Record<string, RegExp> = {
  IN: /bollywood|indian/i,
  PK: /bollywood|indian/i,
  BD: /bollywood|indian/i,
  KR: /k-?pop/i,
  JP: /j-?pop/i,
  CN: /mandopop|cantopop/i,
  TW: /mandopop|cantopop/i,
  HK: /mandopop|cantopop/i,
  MX: /latin/i,
  ES: /latin/i,
  AR: /latin/i,
  CO: /latin/i,
  CL: /latin/i,
  PE: /latin/i,
  SA: /arabic/i,
  AE: /arabic/i,
  EG: /arabic/i,
  NG: /african/i,
  GH: /african/i,
  ZA: /african/i,
  KE: /african/i,
};

/** 2-4 mood/genre tiles for the Home shelves: the region genre first (if any), then Chill / Workout / Party. */
export function pickMoods(moods: Mood[], region?: string, max = 4): Mood[] {
  const usable = moods.filter((m) => m.params);
  const find = (re: RegExp) => usable.find((m) => re.test(m.title));
  const picks: (Mood | undefined)[] = [region ? find(REGION_GENRE[region] ?? /^$/) : undefined, ...MOOD_TITLES.map((t) => find(new RegExp(`^${t}$`, 'i')))];
  const seen = new Set<string>();
  return picks.filter((m): m is Mood => !!m && (seen.has(m.title) ? false : (seen.add(m.title), true))).slice(0, max);
}

const isPlaylist = (s: Shelf) => s.items.length > 0 && s.items.every((i) => i.kind === 'playlist');

/**
 * One shelf for a mood page: the first two playlist carousels merged (deduped, capped), titled with the mood.
 * Undefined when the page has no playlist carousels.
 */
export function moodShelf(title: string, shelves: Shelf[], max = 14): Shelf | undefined {
  const seen = new Set<string>();
  const items = shelves
    .filter(isPlaylist)
    .slice(0, 2)
    .flatMap((s) => s.items as Playlist[])
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .slice(0, max);
  return items.length ? { title, items } : undefined;
}
