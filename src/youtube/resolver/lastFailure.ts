import { playabilityMessage, type PlayabilityClass } from '../playability';

export type FailureNote = { cls: PlayabilityClass; at: number; retryInMs?: number };
const notes = new Map<string, FailureNote>();

/** Remembers why the last resolve of a video failed, so the player can say so (the failure itself passes through the native proxy as plain text). */
export function noteFailure(videoId: string, cls: PlayabilityClass, retryInMs?: number, now = Date.now()): void {
  if (notes.size > 50) notes.delete(notes.keys().next().value as string);
  notes.set(videoId.replace(/^[vm]:/, ''), { cls, at: now, retryInMs });
}

/** The user-facing message for the last failure of `videoId` seen within `maxAgeMs`, or undefined. */
export function failureMessage(videoId: string, now = Date.now(), maxAgeMs = 60_000): string | undefined {
  const n = notes.get(videoId.replace(/^[vm]:/, ''));
  if (!n || n.cls === 'Other' || now - n.at > Math.max(maxAgeMs, n.retryInMs ?? 0)) return undefined;
  const left = n.retryInMs === undefined ? undefined : Math.max(0, n.retryInMs - (now - n.at));
  return playabilityMessage(n.cls, left);
}

/** True when the failure should stop the queue from skipping through every following song (they would all fail the same way). */
export function failureHaltsQueue(videoId: string): boolean {
  const n = notes.get(videoId.replace(/^[vm]:/, ''));
  return n?.cls === 'RateLimited';
}

export const clearFailureNotes = () => notes.clear();
