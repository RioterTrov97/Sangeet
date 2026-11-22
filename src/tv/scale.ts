import { useWindowDimensions } from 'react-native';

/**
 * The TV UI is laid out once in a fixed 1440x810 "design" space (16:9) and the whole tree is scaled to the window, so it
 * looks identical at any density (a 1080p Google TV is 960x540 dp at the standard 320 dpi, a tvdpi emulator ~1440x810).
 * All sizes in src/tv are design px.
 */
export const DESIGN_W = 1440;
export const DESIGN_H = 810;

/** Scale factor from design px to window dp. */
export const tvScaleFor = (windowWidth: number): number => (windowWidth > 0 ? windowWidth / DESIGN_W : 1);

/** The window in design px (always 1440 wide). Use this instead of useWindowDimensions for any TV layout maths. */
export function useTvWindow(): { width: number; height: number; scale: number } {
  const { width, height } = useWindowDimensions();
  const scale = tvScaleFor(width);
  return { width: DESIGN_W, height: Math.round(height / scale), scale };
}
