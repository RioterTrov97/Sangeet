import { LAYOUT_LABELS } from '../player/layout';
import { syncLabel } from '../lyrics/syncAdjust';
import { AUDIO_LABEL, VIDEO_LABEL } from '../youtube/formats';
import type { RemoteLayout, WireLyrics, WireQuality, WireVideoKind, WireVideoState } from './protocol';

/** What the phone's "On TV" strip shows: plain data, so it is unit-tested; the screen maps the icon ids to symbols. */
export type VideoChip = { icon: 'music' | 'lyric' | 'upload' | 'none' | 'failed'; label: string; spinner: boolean };
export type LyricsChip = { icon: 'synced' | 'plain' | 'none' | 'unsure' | 'hidden'; label: string; spinner: boolean; dim: boolean };
export type TvStatus = { layout: RemoteLayout; layoutLabel: string; video: VideoChip; lyrics: LyricsChip; quality?: string };

const VIDEO_LABELS: Record<WireVideoKind, string> = { music: 'Music video', lyric: 'Lyric video', upload: 'Upload' };

export function videoChip(videoId: string | null | undefined, kind: WireVideoKind | undefined, state: WireVideoState | undefined): VideoChip {
  if (state === 'failed') return { icon: 'failed', label: 'Video failed', spinner: false };
  if (state === 'loading') return { icon: kind ?? 'music', label: 'Loading video', spinner: true };
  if (videoId === null) return { icon: 'none', label: 'No video', spinner: false };
  if (videoId === undefined) return { icon: 'none', label: 'Looking for video', spinner: true };
  return { icon: kind ?? 'music', label: kind ? VIDEO_LABELS[kind] : 'Video', spinner: false };
}

export function lyricsChip(l: WireLyrics | undefined): LyricsChip {
  if (!l || l.kind === 'loading') return { icon: 'none', label: 'Lyrics', spinner: true, dim: true };
  if (l.kind === 'none') return { icon: 'none', label: 'No lyrics', spinner: false, dim: true };
  if (l.hidden) return { icon: 'hidden', label: 'Lyrics hidden', spinner: false, dim: true };
  if (l.kind === 'plain') return { icon: 'plain', label: 'Not synced', spinner: false, dim: false };
  if (l.uncertain || l.offsetMs) return { icon: l.uncertain && !l.offsetMs ? 'unsure' : 'synced', label: syncLabel(l.offsetMs), spinner: false, dim: false };
  return { icon: 'synced', label: 'Synced', spinner: false, dim: false };
}

/** The quality that applies to what is on the TV: the video's while a video plays, else the audio's. */
export function qualityLabel(q: WireQuality | undefined, videoPlaying: boolean): string | undefined {
  const id = videoPlaying ? q?.video : q?.audio;
  if (!id) return undefined;
  const label = (videoPlaying ? (VIDEO_LABEL as Record<string, string>) : (AUDIO_LABEL as Record<string, string>))[id];
  return label ?? id;
}

export function tvStatus(layout: RemoteLayout | undefined, info: { resolvedLayout?: RemoteLayout; videoId?: string | null; videoKind?: WireVideoKind; videoState?: WireVideoState; lyrics?: WireLyrics; quality?: WireQuality } | undefined): TvStatus {
  const shown = info?.resolvedLayout ?? layout ?? 'music';
  return {
    layout: shown,
    layoutLabel: LAYOUT_LABELS[shown],
    video: videoChip(info?.videoId, info?.videoKind, info?.videoState),
    lyrics: lyricsChip(info?.lyrics),
    quality: qualityLabel(info?.quality, info?.videoState === 'playing'),
  };
}
