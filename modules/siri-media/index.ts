import { requireNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

export type SiriResultCodeName = 'success' | 'failure' | 'failureNoMatch' | 'failureOffline' | 'failureUnsupported';

type SiriMediaNative = {
  /** JS listener is registered: flush intents queued natively while JS was booting. */
  ready(): void;
  /** Donates playlist titles and artist names to Siri (INVocabulary). */
  setVocabulary(playlists: string[], artists: string[]): void;
  /** Reports the outcome of an intent so Siri can speak about it. */
  complete(id: string, code: SiriResultCodeName): void;
  /** Dev driver: injects an intent through the same native -> JS path (JSON of SiriIntentInput). */
  inject(payload: string): void;
  addListener(event: 'onIntent', listener: (e: { id: string; payload: string }) => void): EventSubscription;
};

export default requireNativeModule<SiriMediaNative>('SiriMedia');
