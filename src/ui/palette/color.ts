/** Small colour maths helpers (sRGB hex <-> HSL, WCAG contrast). Pure, no RN imports. */
export type RGB = { r: number; g: number; b: number };

export function parseHex(hex: string, fallback = '#2a2a2a'): RGB {
  let m = /^#?([0-9a-f]{6})/i.exec(hex) ?? /^#?([0-9a-f]{6})/i.exec(fallback)!;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const toHex = ({ r, g, b }: RGB): string => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

export function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const saturation = (hex: string) => rgbToHsl(parseHex(hex)).s;

/** Mixes `a` towards `b` by `t` (0..1). */
export function mix(a: string, b: string, t: number): string {
  const A = parseHex(a), B = parseHex(b);
  return toHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

/** Returns `hex` with HSL lightness / saturation adjusted. */
export function adjust(hex: string, { l, s }: { l?: (cur: number) => number; s?: (cur: number) => number }): string {
  const c = rgbToHsl(parseHex(hex));
  return toHex(hslToRgb(c.h, Math.max(0, Math.min(1, s ? s(c.s) : c.s)), Math.max(0, Math.min(1, l ? l(c.l) : c.l))));
}

/** Lightens `hex` (HSL) until it reaches `ratio` contrast against `on`, or white. */
export function lightenUntil(hex: string, on: string, ratio: number): string {
  let cur = hex;
  for (let i = 0; i < 40 && contrast(cur, on) < ratio; i++) cur = adjust(cur, { l: (l) => l + 0.03 });
  return contrast(cur, on) >= ratio ? cur : '#ffffff';
}
