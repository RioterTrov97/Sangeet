import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useLyrics, useLyricsTiming } from '../lyrics/useLyrics';
import { useNowPlaying } from '../player';
import { useHostUi } from '../remote/hostUi';
import type { TvInfo } from '../remote/mirror';
import { videoKindOf, type WireLyrics, type WireVideoState } from '../remote/protocol';
import { knownVideoTier, useVideoId } from '../video/counterpart';
import { useVideoStore } from '../video/controller';
import { useQuality } from '../youtube/resolver/qualitySettings';
import { lyricsKind, resolveLayout, usesVideo } from './layout';
import { useTvPlayer } from './playerPrefs';

/**
 * What the TV shows that is not in the player store (the layout it really resolved to, the chosen video, its lyrics), published for
 * the remote host so a phone can mirror it. The host reads this store and pushes a snapshot when it changes.
 */
export const useMirrorInfo = create<{ info: TvInfo }>(() => ({ info: {} }));

const FAILED = new Set(['Video could not be played', 'Video could not be loaded']);

/** Renders nothing. Mounted only while a phone is connected, so an idle TV does not look up videos or lyrics for a song nobody is watching. */
export function MirrorPublisher() {
  const phones = useHostUi((s) => s.phones);
  return phones > 0 ? <Publisher /> : null;
}

function Publisher() {
  const { track } = useNowPlaying();
  const pref = useTvPlayer((s) => s.layout);
  const videoId = useVideoId(track);
  const { status, lyrics } = useLyrics(track);
  const timing = useLyricsTiming(track);
  const quality = useQuality(useShallow((q) => ({ video: q.video, audio: q.audio })));
  const video = useVideoStore(useShallow((v) => ({ mode: v.mode, loading: v.loading, error: v.error })));
  const trackId = track?.id;
  const kind = lyricsKind(status, lyrics);
  const hasVideo = videoId === undefined ? undefined : !!videoId;
  const resolved = resolveLayout(pref, hasVideo, kind);
  const tier = track && videoId ? knownVideoTier(track) : undefined;
  const failedOn = useRef<string | undefined>(undefined);
  const { mode, loading, error } = video;
  const { userOffsetMs, uncertain } = timing;
  const qv = quality.video;
  const qa = quality.audio;
  useEffect(() => {
    // A failure belongs to the song it happened on: remember which, so the next song does not inherit it.
    if (error && FAILED.has(error)) failedOn.current = trackId;
    else if (!error && failedOn.current !== trackId) failedOn.current = undefined;
    const vState: WireVideoState = failedOn.current && failedOn.current === trackId && mode !== 'video' ? 'failed' : loading ? 'loading' : mode === 'video' ? 'playing' : 'none';
    const info: TvInfo = {
      resolvedLayout: resolved,
      ...(videoId !== undefined ? { videoId } : {}),
      ...(tier ? { videoTier: tier, videoKind: videoKindOf(tier) } : {}),
      videoState: vState,
      lyrics: { kind, offsetMs: userOffsetMs, uncertain: uncertain && usesVideo(resolved), hidden: false } satisfies WireLyrics,
      quality: { video: qv, audio: qa },
    };
    if (JSON.stringify(info) !== JSON.stringify(useMirrorInfo.getState().info)) useMirrorInfo.setState({ info });
  }, [trackId, kind, resolved, videoId, tier, mode, loading, error, userOffsetMs, uncertain, qv, qa]);
  return null;
}
