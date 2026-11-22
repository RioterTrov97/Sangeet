import { requireNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

export type RemoteCommand = 'pause' | 'stop' | 'toggle' | 'play' | 'next' | 'previous';

type AudioEventsNative = {
  start(): void;
  addListener(event: 'onRemoteCommand', listener: (e: { command: RemoteCommand }) => void): EventSubscription;
  addListener(event: 'onInterruption', listener: (e: { phase: 'began' | 'ended' }) => void): EventSubscription;
};

export default requireNativeModule<AudioEventsNative>('AudioEvents');
