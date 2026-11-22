import { interpolateColor, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { Palette } from './derive';
import { paletteFrom, paletteProgress, paletteTo } from './store';

/**
 * A colour of the now-playing palette as a shared value that cross-fades between tracks on the UI thread (~600 ms).
 * Use inside `useAnimatedStyle`, never during render. With "Match colours" off the target is the static theme.
 */
export function usePaletteColor(key: keyof Palette): SharedValue<string> {
  return useDerivedValue(() => {
    'worklet';
    return interpolateColor(paletteProgress.value, [0, 1], [paletteFrom.value[key], paletteTo.value[key]]);
  });
}
