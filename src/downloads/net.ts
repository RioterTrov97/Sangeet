import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';

type NetState = { connected: boolean; wifi: boolean; /** Dev flag: pretend there is no network (the host Mac's network is never touched). */ forcedOffline: boolean };

export const useNet = create<NetState>(() => ({ connected: true, wifi: true, forcedOffline: false }));

const listeners = new Set<() => void>();
export const onNetChange = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

let started = false;
export function startNet(): void {
  if (started) return;
  started = true;
  NetInfo.addEventListener((s) => {
    useNet.setState({
      connected: s.isConnected !== false && s.isInternetReachable !== false,
      wifi: s.type === 'wifi' || s.type === 'ethernet',
    });
    listeners.forEach((l) => l());
  });
}

export const isOffline = () => useNet.getState().forcedOffline || !useNet.getState().connected;
export const useIsOffline = () => useNet((s) => s.forcedOffline || !s.connected);

export function setForcedOffline(on: boolean): void {
  useNet.setState({ forcedOffline: on });
  try {
    // Lazy so importing net.ts never loads the native module (jest).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../../modules/stream-proxy').default as { setSimulateOffline?: (on: boolean) => void } | undefined)?.setSimulateOffline?.(on);
  } catch {}
  listeners.forEach((l) => l());
}
