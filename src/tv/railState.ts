/**
 * When the left rail is open, as a pure function so it can be tested. Rules:
 * - The rail opens only when focus enters it because the user pressed a D-pad key a moment ago (`KEY_WINDOW_MS`).
 *   Focus that arrives without a key is the system moving it (the focused view unmounted, a row mounted or recycled): the
 *   rail stays shut and asks the content to take focus back (`reclaim`).
 * - Moving between rail items keeps it open; a destination just chosen collapses it until focus moves to another item.
 */
export const KEY_WINDOW_MS = 700;

export type RailState = { open: boolean; chosen?: string; lastKeyAt: number };
export type RailEvent =
  | { type: 'key'; at: number }
  | { type: 'focus'; name: string; at: number }
  | { type: 'blur' } // focus left the rail items (the close itself follows after a short delay: `close`)
  | { type: 'close' }
  | { type: 'choose'; name: string }
  | { type: 'idle'; focused?: string };

export const initialRail: RailState = { open: false, lastKeyAt: -Infinity };

export function railReduce(s: RailState, e: RailEvent): { state: RailState; reclaim?: boolean } {
  switch (e.type) {
    case 'key':
      return { state: { ...s, lastKeyAt: e.at } };
    case 'focus':
      if (s.chosen === e.name) return { state: s };
      if (s.open) return { state: { ...s, chosen: undefined } };
      if (e.at - s.lastKeyAt <= KEY_WINDOW_MS) return { state: { ...s, chosen: undefined, open: true } };
      return { state: s, reclaim: true };
    case 'blur':
      return { state: { ...s, chosen: undefined } };
    case 'close':
      return { state: { ...s, open: false } };
    case 'choose':
      return { state: { ...s, open: false, chosen: e.name } };
    case 'idle':
      return { state: { ...s, open: false, chosen: e.focused } };
  }
}
