/** Colours and sizes for the shared empty states (phone `EmptyState`, TV `EmptyStateTV`). Pure, so it is unit-tested. */
export type EmptyTone = 'liked' | 'downloads' | 'playlist' | 'neutral' | 'offline' | 'error';

export const EMPTY_TONES: Record<EmptyTone, { color: string; tint: number }> = {
  liked: { color: '#E05A8A', tint: 0.14 },
  downloads: { color: '#3FBF7F', tint: 0.14 },
  playlist: { color: '#8B7CF6', tint: 0.14 },
  /** Grey: the circle is tinted white at about 7%, the icon is grey. */
  neutral: { color: '#9A9A9A', tint: 0.07 },
  offline: { color: '#7A93B3', tint: 0.14 },
  error: { color: '#F15E6C', tint: 0.14 },
};

/** `#RRGGBB` plus an alpha 0..1 as an `rgba()` string. Grey (neutral) tints are white, the rest use the tone colour. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 1000) / 1000})`;
}

export function circleFill(tone: EmptyTone): string {
  const t = EMPTY_TONES[tone];
  return withAlpha(tone === 'neutral' ? '#FFFFFF' : t.color, t.tint);
}

export type EmptyMetrics = { circle: number; icon: number; ringInner: number; ringOuter: number; ringInnerAlpha: number; ringOuterAlpha: number };

/** Phone: 88 circle, 38 icon, rings inset -14 / -30. TV scales everything by ~1.6 (140 / 60). */
export function emptyMetrics(scale: 'phone' | 'tv'): EmptyMetrics {
  const k = scale === 'tv' ? 140 / 88 : 1;
  const circle = scale === 'tv' ? 140 : 88;
  return { circle, icon: scale === 'tv' ? 60 : 38, ringInner: circle + 2 * Math.round(14 * k), ringOuter: circle + 2 * Math.round(30 * k), ringInnerAlpha: 0.18, ringOuterAlpha: 0.08 };
}

/** Ghost rows: [title bar, subtitle bar] widths in phone points, and the opacity of each of the three rows. */
export const GHOST_ROWS: { bars: [number, number]; opacity: number }[] = [
  { bars: [110, 70], opacity: 1 },
  { bars: [140, 60], opacity: 0.7 },
  { bars: [90, 50], opacity: 0.4 },
];

export const EMPTY_DELAY_MS = 150;
export const EMPTY_FADE_MS = 220;
