import type { RemoteLayout, RemoteMode } from '../remote/protocol';

// The pure Now Playing layout model, shared by the TV (which shows a layout) and the phone (which mirrors and chooses it).

/** The six Now Playing layouts on the TV. `video` (Video only) is the default. */
export type TvLayout = RemoteLayout;

export const LAYOUTS: readonly TvLayout[] = ['video', 'videoLyrics', 'videoLyricsOverlay', 'musicLyrics', 'music', 'lyrics'] as const;
export const DEFAULT_LAYOUT: TvLayout = 'video';

export const LAYOUT_LABELS: Record<TvLayout, string> = {
  video: 'Video only',
  videoLyrics: 'Video + lyrics (side)',
  videoLyricsOverlay: 'Video + lyrics (immersive)',
  musicLyrics: 'Music + Lyrics',
  music: 'Music only',
  lyrics: 'Lyrics only',
};

export const isLayout = (x: unknown): x is TvLayout => typeof x === 'string' && (LAYOUTS as readonly string[]).includes(x);

/** Saved value -> layout; anything unknown falls back to the default. */
export const parseLayout = (x: unknown): TvLayout => (isLayout(x) ? x : DEFAULT_LAYOUT);

/** The two Video + Lyrics variants: the split one (`videoLyrics`, internal id kept for the protocol) and the immersive overlay. */
export type VideoLyricsVariant = 'videoLyrics' | 'videoLyricsOverlay';
export const isVideoLyrics = (l: TvLayout): l is VideoLyricsVariant => l === 'videoLyrics' || l === 'videoLyricsOverlay';
export const usesVideo = (l: TvLayout): boolean => l === 'video' || isVideoLyrics(l);
export const showsLyrics = (l: TvLayout): boolean => isVideoLyrics(l) || l === 'musicLyrics' || l === 'lyrics';

export type LyricsKind = 'loading' | 'synced' | 'plain' | 'none';

/**
 * The layout to actually show for the current song. The saved preference is never changed by this: a song without a
 * video drops to the music variant, a song without lyrics drops the lyrics. While still looking (`undefined`/'loading')
 * the preferred layout is kept so the screen does not flicker.
 * @param hasVideo undefined while the video counterpart is being looked up, null/false when there is none
 */
export function resolveLayout(pref: TvLayout, hasVideo: boolean | null | undefined, lyrics: LyricsKind): TvLayout {
  let l = pref;
  if (usesVideo(l) && (hasVideo === false || hasVideo === null)) l = isVideoLyrics(l) ? 'musicLyrics' : 'music';
  if (showsLyrics(l) && lyrics === 'none') l = isVideoLyrics(l) ? 'video' : 'music';
  return l;
}

/** Remote protocol `setMode` (phone: audio/video) -> TV layout. Video keeps the lyrics panel off; audio is the artwork view. */
export const layoutForMode = (mode: RemoteMode): TvLayout => (mode === 'video' ? 'video' : 'music');

/** Which side of the phone's Audio / Video switch a TV layout is on. */
export const sideOfLayout = (l: TvLayout): RemoteMode => (usesVideo(l) ? 'video' : 'audio');

/**
 * The Audio / Video switch on the phone, applied to the TV's current layout: keeps the lyrics panel the TV already shows.
 * Going to video from a lyrics layout uses the Video + Lyrics variant the user used last (`lastVl`, default the split one).
 */
export function layoutForSwitch(current: TvLayout, side: RemoteMode, lastVl: VideoLyricsVariant = 'videoLyrics'): TvLayout {
  if (side === 'video') return current === 'music' ? 'video' : current === 'musicLyrics' || current === 'lyrics' ? lastVl : current;
  return current === 'video' ? 'music' : isVideoLyrics(current) ? 'musicLyrics' : current;
}

/** Lyrics lookup state -> what the layouts care about. */
export function lyricsKind(status: 'loading' | 'ready' | 'none', lyrics: { synced?: readonly unknown[]; plain?: string } | null): LyricsKind {
  if (status === 'loading') return 'loading';
  if (lyrics?.synced?.length) return 'synced';
  if (lyrics?.plain?.trim()) return 'plain';
  return 'none';
}
