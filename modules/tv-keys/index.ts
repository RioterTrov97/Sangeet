import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

export type DpadKey = 'left' | 'right' | 'up' | 'down' | 'center';
/** Remote keys the Activity sees before Android's focus search runs. */
export type TvKey = 'play_pause' | 'play' | 'pause' | 'next' | 'previous' | 'fast_forward' | 'rewind' | DpadKey;
export type TvKeyEvent = { key: TvKey; repeat: number };

type TvKeysNative = {
  /** D-pad keys are only consumed (and reported) while listed here; media keys are always reported. */
  setCaptured(keys: DpadKey[]): void;
  addListener(event: 'onKey', listener: (e: TvKeyEvent) => void): EventSubscription;
  addListener(event: 'onNavKey', listener: (e: { key: DpadKey }) => void): EventSubscription;
};

/** Android-only module (Kotlin, ReactActivityHandler). Absent on iOS. */
const native = requireOptionalNativeModule<TvKeysNative>('TvKeys');

export function onTvKey(listener: (e: TvKeyEvent) => void): { remove(): void } {
  return native ? native.addListener('onKey', listener) : { remove() {} };
}

let wanted: DpadKey[] = [];
let suspended = 0;

export function setCapturedKeys(keys: DpadKey[]): void {
  wanted = keys;
  native?.setCaptured(suspended ? [] : keys);
}

/**
 * While a dialog window (RN Modal) is open the Activity must not capture D-pad keys: the dialog forwards every key-up to the
 * Activity, which would swallow it when captured (OK never clicks, Left/Right never move focus). The screen behind keeps
 * asking for its captures (idle controls, seek bar); they apply again when the last suspension ends.
 */
export function suspendCapture(): () => void {
  suspended++;
  native?.setCaptured([]);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    suspended--;
    if (!suspended) native?.setCaptured(wanted);
  };
}

/**
 * D-pad keys the app did not capture, reported just before Android's focus search moves focus. Lets the rail tell a focus
 * move the user asked for (a key a moment ago) from one the system made (the focused view unmounted).
 */
export function onNavKey(listener: (key: DpadKey) => void): { remove(): void } {
  return native ? native.addListener('onNavKey', (e) => listener(e.key)) : { remove() {} };
}
