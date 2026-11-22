import { useEffect, useState } from 'react';

import { formatDuration } from '../player/format';
import type { Track } from '../youtube/models';
import { canChooseVideo, chooseVideo, getVideoCandidates, hasOverride, recheckVideo, useCounterparts, type SlimCand, type VideoChoice } from './counterpart';
import type { VideoTier } from './match';

/** Preview image of a YouTube video. */
export const videoThumb = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

export const TIER_BADGE: Record<VideoTier, string> = { A: 'Music video', B: 'Lyric video', C: 'Upload' };

export function formatViews(n: number | undefined): string {
  if (!n || n <= 0) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B views`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M views`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K views`;
  return `${n} views`;
}

export type PickerRow = { id: string; title: string; channel: string; verified: boolean; duration: string; views: string; badge: string; current: boolean };

/** Rows for the picker: the top candidates, with the video now playing included even when the list does not have it. */
export function pickerRows(cands: SlimCand[], current: string | null): PickerRow[] {
  const rows: PickerRow[] = cands.map((c) => ({ id: c.id, title: c.title, channel: c.ch ?? '', verified: !!c.verified, duration: c.dur ? formatDuration(c.dur) : '', views: formatViews(c.views), badge: TIER_BADGE[c.tier], current: c.id === current }));
  if (current && !cands.some((c) => c.id === current)) rows.unshift({ id: current, title: 'Current video', channel: 'From YouTube Music', verified: false, duration: '', views: '', badge: TIER_BADGE.A, current: true });
  return rows;
}

export type VideoPicker = { rows: PickerRow[]; loading: boolean; checking: boolean; current: string | null; overridden: boolean; none: boolean; choose: (id: string) => void; noVideo: () => void; reset: () => void; check: () => void };

/** The picker's data and actions for one song. Does nothing until `active` (a closed or hidden picker costs no requests). */
export function useVideoPicker(track: Track | undefined, active = true): VideoPicker {
  const [choice, setChoice] = useState<VideoChoice>();
  const [checking, setChecking] = useState(false);
  const id = track?.id;
  const map = useCounterparts((s) => s.map);
  useEffect(() => {
    if (!active || !track || !canChooseVideo(track)) return;
    let dead = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while the next song loads
    setChoice(undefined);
    void getVideoCandidates(track).then((c) => !dead && setChoice(c)).catch(() => !dead && setChoice({ cands: [], current: null, overridden: false }));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the song id
  }, [id, active]);
  const current = id ? (map[id] ?? null) : null;
  const overridden = id ? hasOverride(id) : false;
  return {
    rows: choice ? pickerRows(choice.cands, current) : [],
    loading: !choice,
    checking,
    current,
    overridden,
    none: overridden && current === null,
    choose: (v) => id && chooseVideo(id, v),
    noVideo: () => id && chooseVideo(id, 'none'),
    reset: () => id && chooseVideo(id, null),
    check: () => {
      if (!track || checking) return;
      setChecking(true);
      void recheckVideo(track)
        .then(setChoice)
        .catch(() => {})
        .finally(() => setChecking(false));
    },
  };
}
