import type { Track } from '../youtube/models';

/** `dur` (seconds) only when the source gives word end times (TTML). */
export type LrcWord = { time: number; text: string; dur?: number };
/** `time` in seconds. `words` only when the source has word-level timings. */
export type LrcLine = { time: number; text: string; words?: LrcWord[] };

export type Lyrics = {
  synced?: LrcLine[];
  plain?: string;
  /** Human label, e.g. "LRCLIB". */
  source: string;
  /** 'file': a `.lrc` file next to a song from this iPhone. */
  providerId: ProviderId | 'file';
  /** Source-declared offset in ms (LRC `[offset:]`), already applied to `synced` times when parsed. */
  offsetMs?: number;
  /** Length of the recording the source timed these lyrics for (LRCLIB `duration`), when it says. */
  durationSec?: number;
};

export type ProviderId = 'lrclib' | 'lrcred' | 'netease' | 'ytmusic';

export type LyricsProvider = {
  id: ProviderId;
  label: string;
  getLyrics(track: Track, signal?: AbortSignal): Promise<Omit<Lyrics, 'source' | 'providerId'> | null>;
};
