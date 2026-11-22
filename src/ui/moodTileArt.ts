import { mix } from './palette/color';

/** [keyword regex, SF Symbol] — first match wins, so order specific before generic. */
const ICONS: [RegExp, string][] = [
  [/k-?pop|j-?pop/i, 'star.fill'],
  [/hip.?hop|rap|trap|r&b/i, 'mic.fill'],
  [/rock|metal|punk|grunge|indie|guitar/i, 'guitars.fill'],
  [/dance|electronic|edm|house|techno|club/i, 'waveform'],
  [/jazz|blues|soul|sax/i, 'music.quarternote.3'],
  [/classic|piano|orchestra|instrumental/i, 'pianokeys'],
  [/sleep/i, 'moon.zzz.fill'],
  [/chill|relax|calm|ambient|mellow|wind down/i, 'leaf.fill'],
  [/workout|energ|gym|run|gaming|pump|fitness|motivat/i, 'flame.fill'],
  [/romanc|love|heart/i, 'heart.fill'],
  [/party|celebrat|fun|feel good|happy/i, 'sparkles'],
  [/focus|study|work|concentrat/i, 'headphones'],
  [/commut|drive|road|travel|car/i, 'car.fill'],
  [/sad|melanchol|night|dark|moody/i, 'moon.fill'],
  [/country|folk|acoustic|americana/i, 'tree.fill'],
  [/latin|reggae|afro|world|bollywood|desi|indian|punjabi|tamil|telugu|hindi|bhojpuri|bengali|devotional/i, 'globe.asia.australia.fill'],
  [/pop|hits|top|trending/i, 'star.fill'],
];

export function moodIcon(title: string): string {
  return ICONS.find(([re]) => re.test(title))?.[1] ?? 'music.note';
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Tiny deterministic PRNG (mulberry32) seeded from the title. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type TileShape = { d: string; fill: string; opacity: number };

/** 2-3 soft overlapping curved blobs in a 100x80 viewBox, lighter/darker tints of `color`, varied per title. */
export function tileShapes(title: string, color: string): TileShape[] {
  const r = rng(hash(title));
  const tints = [mix(color, '#ffffff', 0.28), mix(color, '#000000', 0.22), mix(color, '#ffffff', 0.14)];
  const n = 2 + Math.floor(r() * 2);
  return Array.from({ length: n }, (_, i) => {
    const cx = 10 + r() * 80;
    const cy = 5 + r() * 70;
    const rx = 30 + r() * 30;
    const ry = 22 + r() * 26;
    const k = 0.45 + r() * 0.25; // control-point lean makes each blob lopsided
    const sx = (r() - 0.5) * 30;
    const sy = (r() - 0.5) * 30;
    const d = `M${cx - rx},${cy} C${cx - rx},${cy - ry * k * 2} ${cx + sx},${cy - ry} ${cx + rx},${cy - sy} C${cx + rx},${cy + ry * k * 2} ${cx - sx},${cy + ry} ${cx - rx},${cy} Z`;
    return { d, fill: tints[i % tints.length], opacity: 0.3 + r() * 0.25 };
  });
}
