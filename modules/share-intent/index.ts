import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

type ShareIntentNative = {
  getInitial(): string | null;
  addListener(event: 'onShare', listener: (e: { text: string }) => void): EventSubscription;
};

/** Android only (Kotlin); absent on iOS and in tests. */
export const shareIntent = requireOptionalNativeModule<ShareIntentNative>('ShareIntent');
