import type { RemoteCommand } from './index';

/** No-op on Android: media keys and audio focus are handled by Media3 inside nitro-player. */
const noop = { remove() {} };
export type { RemoteCommand };
export default {
  start() {},
  addListener(_event: 'onRemoteCommand' | 'onInterruption', _listener: (e: never) => void) {
    return noop;
  },
};
