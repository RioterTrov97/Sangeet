import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

export type RemoteCommand = 'pause' | 'stop' | 'toggle' | 'play' | 'next' | 'previous';

type AudioEventsNative = {
  start(): void;
  addListener(event: 'onRemoteCommand', listener: (e: { command: RemoteCommand }) => void): EventSubscription;
  addListener(event: 'onInterruption', listener: (e: { phase: 'began' | 'ended' }) => void): EventSubscription;
};

const noop = { remove() {} };

/** iOS (Swift) and Android (Kotlin). Loaded optionally so a build without the native side (tests, web) just reports nothing. */
const native = requireOptionalNativeModule<AudioEventsNative>('AudioEvents');

export default (native ?? {
  start() {},
  addListener() {
    return noop;
  },
}) as AudioEventsNative;
