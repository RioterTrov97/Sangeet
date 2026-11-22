import { adjust, contrast, lightenUntil, mix, parseHex, rgbToHsl, saturation, toHex } from './color';

/** Raw colours as returned by react-native-image-colors on iOS. */
export type RawColors = { background?: string; primary?: string; secondary?: string; detail?: string };

export type Palette = {
  /** Page background: deep, never lighter than ~28 % lightness so white text always reads. */
  bg: string;
  /** Darker companion for sheets and the bottom of gradients. */
  bgDeep: string;
  /** Most saturated artwork colour, lightened to >= 3:1 against `bg`. */
  accent: string;
  /** Text/icon colour on top of `accent` (black or white, whichever contrasts more). */
  onAccent: string;
  text: string;
  /** Secondary text, >= 4.5:1 against `bg`. */
  textDim: string;
  /** Low-alpha tint for glass surfaces. */
  glassTint: string;
  /** Lyric lines: a warm tint of the palette, to be used at 30-40 % opacity. */
  lyricDim: string;
  /** Vivid fill for the collapsed player (white text >= 4.5:1). */
  vivid: string;
};

export const STATIC_PALETTE: Palette = {
  bg: '#121212',
  bgDeep: '#0b0b0b',
  accent: '#1ed760',
  onAccent: '#000000',
  text: '#ffffff',
  textDim: '#b3b3b3',
  glassTint: 'rgba(255,255,255,0.08)',
  lyricDim: '#ffffff',
  vivid: '#2a2a2a',
};

const FALLBACK = '#2a2a2a';
const valid = (c?: string) => (c && /^#?[0-9a-f]{6}/i.test(c) ? c : undefined);

/** Darkens/desaturates a colour into a background that stays legible with white text (>= 7:1 on white). */
export function toBackground(hex: string, maxLightness = 0.3, maxSat = 0.6): string {
  return adjust(hex, { l: (l) => Math.min(l, maxLightness), s: (s) => Math.min(s, maxSat) });
}

/** Vivid but still white-text-safe: keeps saturation, caps lightness so white contrast >= 4.5. */
export function toVivid(hex: string): string {
  let cur = adjust(hex, { s: (s) => Math.max(s, 0.45), l: (l) => Math.min(Math.max(l, 0.3), 0.5) });
  for (let i = 0; i < 40 && contrast('#ffffff', cur) < 4.5; i++) cur = adjust(cur, { l: (l) => l - 0.02 });
  return cur;
}

export function derivePalette(raw: RawColors): Palette {
  const cands = [raw.primary, raw.secondary, raw.detail, raw.background].map(valid).filter(Boolean) as string[];
  const rawBase = valid(raw.background) ?? cands[0] ?? FALLBACK;
  // Accent: the most saturated candidate (greyscale artwork falls back to neutral white-ish).
  const sat = [...cands].sort((a, b) => saturation(b) - saturation(a))[0] ?? rawBase;
  // A near-black artwork background gives a dull player: take the colourful candidate instead (it is darkened below anyway).
  const base = rgbToHsl(parseHex(rawBase)).l < 0.12 && saturation(sat) > 0.25 ? sat : rawBase;
  const greyscale = saturation(sat) < 0.12;

  const bg = toBackground(greyscale ? mix(base, '#202020', 0.35) : base, 0.3, greyscale ? 0.08 : 0.6);
  const bgDeep = adjust(bg, { l: (l) => l * 0.55 });
  const accentSeed = greyscale ? '#d9d9d9' : adjust(sat, { s: (s) => Math.max(s, 0.55) });
  const accent = lightenUntil(accentSeed, bg, 3);
  const onAccent = contrast('#000000', accent) >= contrast('#ffffff', accent) ? '#000000' : '#ffffff';
  const text = '#ffffff';
  let textDim = mix('#ffffff', bg, 0.3);
  textDim = lightenUntil(textDim, bg, 4.5);
  const { r, g, b } = parseHex(mix(bg, '#ffffff', 0.18));
  const glassTint = `rgba(${r},${g},${b},0.32)`;
  const lyricDim = adjust(mix(accent, '#ffffff', 0.35), { s: (s) => Math.min(s, 0.5) });
  const vivid = toVivid(greyscale ? '#4a4a4a' : sat);
  return { bg, bgDeep, accent, onAccent, text, textDim, glassTint, lyricDim, vivid };
}

/** Mid-gradient stop used with bg/bgDeep for the full-bleed Now Playing background. */
export const gradientStops = (p: Palette) => [mix(p.bg, '#ffffff', 0.04), p.bg, p.bgDeep] as const;

/**
 * Foreground colours for text and icons on `bg`: light or dark by luminance, a dimmed secondary (>= 4.5:1, for artist and
 * times) and a clearly visible inactive-icon colour (>= 3:1). The palette backgrounds are always dark, but light backgrounds
 * (a future theme, a sampled light colour) flip to dark text instead of failing.
 */
export function foregroundFor(bg: string): { text: string; dim: string; inactive: string } {
  const light = contrast('#ffffff', bg) >= contrast('#000000', bg);
  const text = light ? '#ffffff' : '#0b0b0b';
  let dim = mix(text, bg, 0.22);
  for (let i = 0; i < 20 && contrast(dim, bg) < 4.5; i++) dim = mix(dim, text, 0.25);
  let inactive = mix(text, bg, 0.2);
  for (let i = 0; i < 20 && contrast(inactive, bg) < 3; i++) inactive = mix(inactive, text, 0.25);
  return { text, dim, inactive };
}

export { rgbToHsl, toHex };
