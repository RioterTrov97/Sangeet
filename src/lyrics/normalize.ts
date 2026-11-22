/** Title/artist normalisation for lyric lookups: strips video/lyrics tags, feat. credits, remaster notes. */

const NOISE_WORDS =
  'official(?:\\s+(?:music|lyric|lyrics|audio|video|visualizer|visualiser|hd|4k))*|music\\s+video|lyric(?:s)?(?:\\s+video)?|audio|video|visuali[sz]er|hd|hq|4k|explicit|clean|remaster(?:ed)?(?:\\s+\\d{4})?|\\d{4}\\s+remaster(?:ed)?|remaster(?:ed)?\\s+version|mono|stereo|live(?:\\s+.*)?|deluxe(?:\\s+edition)?|bonus\\s+track|radio\\s+edit|single\\s+version|album\\s+version|from\\s+.*';
const BRACKET_NOISE = new RegExp(`\\s*[\\(\\[\\{]\\s*(?:${NOISE_WORDS})\\s*[\\)\\]\\}]`, 'gi');
const FEAT_BRACKET = /\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^\)\]]*[\)\]]/gi;
const FEAT_TAIL = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;
const DASH_NOISE = new RegExp(`\\s+[-–—]\\s+(?:${NOISE_WORDS})\\s*$`, 'i');

export function normalizeTitle(raw: string): string {
  let t = raw.normalize('NFKC');
  // Repeat: "Song (Official Video) [HD]" has several tags.
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(FEAT_BRACKET, '').replace(BRACKET_NOISE, '').replace(DASH_NOISE, '');
    if (t === before) break;
  }
  t = t.replace(FEAT_TAIL, '');
  // Hindi / Nepali uploads: "Song | Movie name" (also the full-width bar): keep the part before the first bar.
  const bar = t.search(/\s*[|\uFF5C]\s*/);
  if (bar > 0) t = t.slice(0, bar);
  return t.replace(/\s{2,}/g, ' ').trim();
}

export function normalizeArtist(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\s*[-–—]\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** First/lead artist only: lookups match better without "A, B & C". */
export function leadArtist(artists: string): string {
  return normalizeArtist(artists.split(/\s*(?:,|&|\bx\b|\bfeat\.?\b|\bft\.?\b)\s*/i)[0] ?? artists);
}

/** For song-upload titles of the form "Artist - Title": returns the title part when the prefix is the artist. */
export function stripArtistPrefix(title: string, artist: string): string {
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return title;
  return m[1].trim().toLowerCase() === artist.trim().toLowerCase() ? m[2].trim() : title;
}

/**
 * Romanisation skeleton for comparing Nepali/Hindi spellings: collapses the usual variants (ee/i, oo/u, chh/ch, kh/k ...)
 * and drops vowels and "h", so "Eakchhina Timi" and "Ekai Chhin Timi" both become "kcntm". Non-Latin letters are dropped.
 */
export function romanSkeleton(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/chh/g, 'c')
    .replace(/ch/g, 'c')
    .replace(/(sh|kh|th|dh|ph|bh|gh|jh)/g, (m) => m[0])
    .replace(/[aeiouyh]/g, '')
    .replace(/\s+/g, '');
}
