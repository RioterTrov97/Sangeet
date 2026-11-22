import type { Track } from '../youtube/models';

/** One song of the index (persisted). `art` is a file name in the hidden art folder. */
export type LocalSong = {
  id: string;
  /** Path relative to Documents/Music, `/` separated. */
  rel: string;
  size: number;
  mtime: number;
  title: string;
  artists: string[];
  album?: string;
  durationSec?: number;
  art?: string;
  addedAt: number;
};

/** The song as a normal queue track. `artUri` is the artwork's file uri (undefined: none). */
export function toTrack(s: LocalSong, artUri?: string): Track {
  return {
    kind: 'track',
    id: s.id,
    title: s.title,
    artists: s.artists.map((name) => ({ name })),
    // No album page exists for a local album: the empty id keeps the "View album" action away.
    album: s.album ? { id: '', name: s.album } : undefined,
    durationSec: s.durationSec,
    artwork: artUri ? [{ url: artUri }] : [],
  };
}

/** Newest first; ties by title so a bulk import has a stable order. */
export const byAddedDesc = (a: LocalSong, b: LocalSong): number => b.addedAt - a.addedAt || a.title.localeCompare(b.title);
