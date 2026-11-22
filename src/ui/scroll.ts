import { FlashList, type FlashListProps } from '@shopify/flash-list';
import type { ComponentType } from 'react';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

/** Shared scroll offset + handler for collapsing headers. */
export function useScrollY() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  return { scrollY, onScroll };
}

/** FlashList whose onScroll can be a Reanimated worklet handler. */
export const AnimatedFlashList = Animated.createAnimatedComponent(FlashList) as unknown as ComponentType<Omit<FlashListProps<any>, 'onScroll'> & { onScroll?: unknown }>;
