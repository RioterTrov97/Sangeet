import type { Persisted } from './queue';

/**
 * Closing the mini player (swipe down / "Close player" action). Dependencies are injected so the state logic is testable.
 * Local: pause, clear the queue and the saved queue; Undo reloads the queue, index and position paused.
 * Remote (phone controlling a TV): only leave the TV (it keeps playing); Undo redials it.
 */
export type TvLink = { target: string; name?: string; tvId?: string };

export type CloseDeps = {
  isRemote: () => boolean;
  /** Current local queue record, undefined when there is nothing to close. */
  snapshot: () => Persisted | undefined;
  closeLocal: () => Promise<void>;
  restoreLocal: (p: Persisted) => Promise<void>;
  tvLink: () => TvLink | undefined;
  disconnectTv: () => void;
  connectTv: (l: TvLink) => Promise<void>;
  notify: (text: string, undo: () => void) => void;
  haptic: () => void;
};

export function closePlayer(d: CloseDeps): Promise<void> {
  d.haptic();
  if (d.isRemote()) {
    const link = d.tvLink();
    d.disconnectTv();
    if (link) d.notify('Disconnected from TV', () => void d.connectTv(link));
    return Promise.resolve();
  }
  const snap = d.snapshot();
  if (!snap) return Promise.resolve();
  return d.closeLocal().then(() => d.notify('Player closed', () => void d.restoreLocal(snap)));
}
