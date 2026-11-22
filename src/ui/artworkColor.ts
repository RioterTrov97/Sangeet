import { useEffect, useState } from 'react';
import { getColors } from 'react-native-image-colors';

const FALLBACK = '#2a2a2a';
/** Keeps white text readable: scales bright artwork colours down to at most ~45% luminance. */
export function dim(hex: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return FALLBACK;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const k = lum > 0.4 ? 0.4 / lum : 1;
  return `#${[r, g, b].map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('')}`;
}

const memo = new Map<string, string>();

/** Dominant/background colour of an artwork URL, for tinted gradients. Cached per URL. */
export function useArtworkColor(url?: string): string {
  const [color, setColor] = useState(() => (url && memo.get(url)) || FALLBACK);
  useEffect(() => {
    if (!url) return;
    const hit = memo.get(url);
    if (hit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from memo when the URL changes
      setColor(hit);
      return;
    }
    let alive = true;
    getColors(url, { fallback: FALLBACK, cache: true, key: url })
      .then((c) => {
        const col = dim(c.platform === 'ios' ? c.background : c.platform === 'android' ? c.dominant : FALLBACK);
        memo.set(url, col);
        if (alive) setColor(col);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return color;
}
