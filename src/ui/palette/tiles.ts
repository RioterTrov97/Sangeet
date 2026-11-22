import { contrast } from './color';
import { toVivid } from './derive';

/** Vivid fallback palette for tiles without a provider colour; picked by a stable hash of the title. */
export const TILE_PALETTE = ['#d6336c', '#7048e8', '#1c7ed6', '#0c8599', '#2b8a3e', '#e8590c', '#c2255c', '#5f3dc4', '#e03131', '#1971c2', '#087f5b', '#f08c00'];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** Tile colour: the provider's colour when present, otherwise a deterministic vivid one; always >= 4.5:1 against white text. */
export function tileColor(title: string, provided?: string): string {
  const base = provided && /^#[0-9a-f]{6}$/i.test(provided) ? provided : TILE_PALETTE[hash(title) % TILE_PALETTE.length];
  return contrast('#ffffff', base) >= 4.5 ? base : toVivid(base);
}
