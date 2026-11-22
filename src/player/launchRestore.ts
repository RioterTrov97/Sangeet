/**
 * Launch rule for the phone: the saved queue (and with it the mini player) comes back only when the previous
 * session actually played something. A session that restored a queue but never pressed play does not count, so the
 * launch after it starts clean. The queue stays on disk either way: CarPlay "Resume" and the TV handback restore it on demand.
 */
export type LaunchInput = { hasSavedQueue: boolean; lastSessionPlayed: boolean };

export const shouldRestoreAtLaunch = (i: LaunchInput): boolean => i.hasSavedQueue && i.lastSessionPlayed;

/** The persisted flag: written `false` at the start of every session, `true` once local playback reaches `playing`. */
export type SessionRecord = { played: boolean; at: number };
export const parseSession = (x: unknown): boolean => !!x && typeof x === 'object' && (x as SessionRecord).played === true;
