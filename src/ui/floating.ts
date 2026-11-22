import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayerStore } from '../player/store';

/** Heights of the floating chrome (kept in one place so list insets match the layout). */
export const TAB_H = 58;
export const MINI_H = 68;
export const FLOAT_GAP = 8;
export const SIDE = 12;

/** Distance from the screen edge to the floating chrome: tucked toward the home indicator like iOS 26 bars. */
export function floatBottom(inset: number): number {
  // Android draws edge to edge under the gesture / navigation bar: sit above it instead of tucking toward the home indicator.
  if (Platform.OS === 'android') return inset + FLOAT_GAP;
  return Math.max(inset - 18, FLOAT_GAP);
}

/** Bottom padding a tab-screen list needs so its last row clears the floating mini-player and tab bar. */
export function useFloatingInset(): number {
  const { bottom } = useSafeAreaInsets();
  const hasTrack = usePlayerStore((s) => !!s.queue[s.index]);
  return floatBottom(bottom) + TAB_H + FLOAT_GAP + (hasTrack ? MINI_H + FLOAT_GAP : 0) + FLOAT_GAP;
}
