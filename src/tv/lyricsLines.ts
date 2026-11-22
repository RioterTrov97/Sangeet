import type { LrcLine } from '../lyrics/types';

const NONE: LrcLine[] = [];
/** Synced lines or an empty list (stable reference). */
export const lyricsFor = (synced: LrcLine[] | undefined): LrcLine[] => (synced?.length ? synced : NONE);
