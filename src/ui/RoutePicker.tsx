import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

type AirPlayState = { available: boolean; active: boolean; /** Name of the current audio output. */ route: string };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy so tests/web never load the native module
const mod = () => require('../../modules/route-picker') as typeof import('../../modules/route-picker');

/** AirPlay routes reachable (AVRouteDetector) and whether an AirPlay route is playing now. On Android `available` means the system output switcher exists (`active` is never set); off elsewhere. */
export function useAirPlay(): AirPlayState {
  const [s, setS] = useState<AirPlayState>(() => (Platform.OS === 'ios' ? { available: mod().airPlayAvailable(), active: mod().airPlayActive(), route: mod().currentRouteName() } : { available: Platform.OS === 'android' && !Platform.isTV && mod().airPlayAvailable(), active: false, route: '' }));
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = mod().onAirPlayChange((s) => setS({ ...s, route: mod().currentRouteName() }));
    return () => sub.remove();
  }, []);
  return s;
}

/** Opens the system AirPlay sheet immediately (iOS), or the system output switcher (Android). */
export function showAirPlayPicker(): void {
  if (Platform.OS === 'ios' || Platform.OS === 'android') mod().showAirPlayPicker();
}
