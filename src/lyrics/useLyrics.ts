import { useEffect, useMemo, useState } from 'react';

import { usePlayerStore } from '../player/store';
import { setTvLyricsOffset, useRemote } from '../remote/phone';
import { useVideoStore } from '../video/controller';
import { lyricsStretchFor, stretchLines } from '../video/timeline';
import { useVideoShift } from '../video/useVideoShift';
import type { Track } from '../youtube/models';
import { getLyrics } from './index';
import { setLyricsOffset, useLyricsOffsets } from './settings';
import type { LyricsSync } from './syncAdjust';
import type { Lyrics } from './types';

export type LyricsState = { status: 'loading' | 'ready' | 'none'; lyrics: Lyrics | null; /** The video is another cut: the synced lyrics were stretched over its length (shown as "May be out of sync"). */ stretched?: boolean };

/**
 * The song's lyrics. They are timed to the song and are the same in song and video mode: video mode shifts their clock
 * (see useLyricsTiming), it never turns synced lyrics into plain ones.
 */
export function useLyrics(track: Track | undefined): LyricsState {
  const [state, setState] = useState<LyricsState & { id?: string }>({ status: 'loading', lyrics: null });
  const id = track?.id;
  useEffect(() => {
    if (!track) return;
    let live = true;
    getLyrics(track)
      .then((lyrics) => live && setState({ status: lyrics ? 'ready' : 'none', lyrics, id }))
      .catch(() => live && setState({ status: 'none', lyrics: null, id }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const cur = state.id === id || !track ? state : { status: 'loading' as const, lyrics: null };
  const shift = useVideoShift(track);
  const inVideo = useVideoStore((s) => s.mode === 'video');
  const videoSec = usePlayerStore((s) => s.duration);
  // Controlling a TV: the phone shows song-timed lyrics against the phone's song clock, so no stretch applies.
  const tv = useTvLyrics();
  const stretch = tv || !inVideo || !cur.lyrics?.synced?.length ? undefined : lyricsStretchFor(shift !== undefined, track?.durationSec, videoSec);
  return useMemo(() => {
    if (!stretch || !cur.lyrics?.synced) return { status: cur.status, lyrics: cur.lyrics };
    return { status: cur.status, lyrics: { ...cur.lyrics, synced: stretchLines(cur.lyrics.synced, stretch) }, stretched: true };
  }, [cur.status, cur.lyrics, stretch]);
}

/** User sync offset for the track in ms (positive = lyrics earlier). */
export function useUserLyricsOffset(videoId: string | undefined): number {
  return useLyricsOffsets((s) => (videoId ? s.offsets[videoId] ?? 0 : 0));
}

export type LyricsTiming = {
  /** What the views add to the playback clock: the user's offset minus the song -> video shift, in ms. Positive = lyrics earlier. */
  offsetMs: number;
  /** The user's own offset (what the +/- control edits). */
  userOffsetMs: number;
  /** Video mode with a timeline offset nobody could determine: synced lyrics are shown but may be out of sync. */
  uncertain: boolean;
};

/**
 * Lyrics clock offset for the track on screen. The lyric cues are song time; in video mode the playback position is
 * video time (song time + shift), so the clock handed to the lyrics is shifted back by `shift`. Views look a cue up with
 * `position + offsetMs / 1000` and seek to `cue - offsetMs / 1000`, which stays right in both modes.
 */
export function useLyricsTiming(track: Track | undefined): LyricsTiming {
  const userOffsetMs = useUserLyricsOffset(track?.id);
  const shift = useVideoShift(track);
  const tv = useTvLyrics();
  // Controlling a TV that reports its lyrics: the phone's clock is song time already, so only the TV's own offset applies.
  return useMemo(() => (tv ? { offsetMs: tv.offsetMs, userOffsetMs: tv.offsetMs, uncertain: tv.uncertain } : { offsetMs: userOffsetMs - (shift ?? 0) * 1000, userOffsetMs, uncertain: shift === undefined }), [userOffsetMs, shift, tv]);
}

/** The TV's lyrics state while the phone controls a TV that reports it (a new TV), else undefined. */
function useTvLyrics() {
  return useRemote((r) => (r.status !== 'off' ? r.tvInfo?.lyrics : undefined));
}

/** Same as `useLyricsTiming(track).offsetMs`. */
export const useLyricsOffset = (track: Track | undefined): number => useLyricsTiming(track).offsetMs;

/** The sync control's state for a track: the user offset, whether the timing is a guess, and a setter that saves per song. */
export function useLyricsSync(track: Track | undefined): LyricsSync | undefined {
  const timing = useLyricsTiming(track);
  const id = track?.id;
  const tv = useTvLyrics();
  return useMemo(() => (id ? { ms: timing.userOffsetMs, uncertain: timing.uncertain, onChange: (ms: number) => (tv ? setTvLyricsOffset(id, Math.round(ms)) : setLyricsOffset(id, Math.round(ms))) } : undefined), [id, timing.userOffsetMs, timing.uncertain, tv]);
}
