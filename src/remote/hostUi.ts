import { create } from 'zustand';

/** How long the TV shows "Starting playback" before falling back to the empty Now Playing screen. */
export const STARTING_MS = 15_000;

/**
 * What the TV screen shows for the remote host: the "Controlled by" toast, and `starting` while a phone command is
 * loading the first song (the app may have just been launched by it, so the queue is still empty).
 */
export const useHostUi = create<{ toast?: { text: string; id: number }; starting?: { from: string; at: number }; /** Phones connected right now. */ phones: number }>(() => ({ phones: 0 }));

export const markStarting = (from: string): void => useHostUi.setState({ starting: { from, at: Date.now() } });
export const clearStarting = (): void => {
  if (useHostUi.getState().starting) useHostUi.setState({ starting: undefined });
};
