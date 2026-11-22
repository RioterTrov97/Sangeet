import type { Track } from '../youtube/models';

/**
 * Tiny registry the queue controller consults while video mode is active (so it needs no import of the video
 * controller, which imports the queue). In video mode the native audio player stays paused and the video player owns
 * playback; the store's position/status are mirrored from the video player.
 */
export type VideoHooks = {
  seek: (sec: number) => void;
  toggle: () => void;
  trackChanged: (id: string) => void;
  /** Make the video player play (a new queue started on the track that is already open as video). */
  play: () => void;
  /** A Next / skip-to was pressed: `target` is the track the queue is about to land on (start its video without waiting for the native change). */
  skipping: (target: Track | undefined) => void;
};
/**
 * `startAt`: a new queue asked to start its first track part-way (a link's `t=`) while video mode is open. Song time,
 * in seconds; the video controller takes it (once) when it loads that track's video.
 */
export const videoFlag: { active: boolean; hooks?: VideoHooks; startAt?: { id: string; sec: number } } = { active: false };

/** The start requested for `id` by the queue that just started, consumed (later loads of that track start normally). */
export function takeVideoStart(id: string): number | undefined {
  const s = videoFlag.startAt;
  videoFlag.startAt = undefined;
  return s && s.id === id ? s.sec : undefined;
}

/** Whether playback should continue when the app leaves the foreground. The phone always hands video back to audio and keeps playing; the TV overrides this with its "Keep playing in background" setting. */
export const backgroundPolicy: { keepPlaying: () => boolean } = { keepPlaying: () => true };

/**
 * A new queue was started (phone remote, Home) while video mode is open. When it starts on the track that is already
 * showing, the native player reports no track change, so nothing restarts the video: it must be told to seek and play.
 * A different track goes through the normal track-changed hook.
 */
export const restartsOpenVideo = (videoActive: boolean, currentId: string | undefined, startId: string): boolean => videoActive && !!currentId && currentId === startId;
