import { Image } from 'expo-image';
import { useState } from 'react';
import { PixelRatio, Platform, View, type ImageStyle, type StyleProp } from 'react-native';

import { rebaseLocalArt } from '../local';
import { hasLetterbox, pickArtwork, ytimgFallbacks } from '../youtube/mappers/common';
import type { Artwork as ArtworkModel } from '../youtube/models';

/** Zoom that crops the 45 px bars off a 480x360 (4:3) frame holding a 16:9 picture, leaving a square. */
const BAR_ZOOM = 360 / 270;

/** The URL `Artwork` requests for `art` at `size` (so it can be prefetched into the same cache entry). */
export const artworkUri = (art: ArtworkModel[], size: number): string | undefined => pickArtwork(art, Math.min(1200, Math.round(size * Math.min(PixelRatio.get(), 3))));

/**
 * Picks the artwork URL for the display size at the device pixel ratio (square YT Music art when the item has it, else a
 * bar-free video frame), recycles by URL in lists, and falls back sddefault -> hqdefault (zoomed to hide the bars)
 * when maxresdefault does not exist for a video.
 */
export function Artwork({ art, size = 48, round = false, style, saved, preferSaved }: { art: ArtworkModel[]; size?: number; round?: boolean; style?: StyleProp<ImageStyle>; /** On-device copy (file uri): tried first when `preferSaved` (offline), else after the remote ones fail. */ saved?: string; preferSaved?: boolean }) {
  const raw = artworkUri(art, size);
  // A cover of a song from this iPhone is a file in the app's container, whose path changes with an update: point it at the current one.
  const remote = raw ? rebaseLocalArt(raw) : raw;
  const base = saved && (preferSaved || !remote) ? saved : remote;
  const [failed, setFailed] = useState({ base, step: 0 });
  const step = failed.base === base ? failed.step : 0;
  const chain = !base ? [] : base === saved ? [saved, ...(remote ? [remote, ...ytimgFallbacks(remote)] : [])] : [base, ...ytimgFallbacks(base), ...(saved ? [saved] : [])];
  const uri = chain[Math.min(step, chain.length - 1)];
  const image = (extra?: StyleProp<ImageStyle>) => (
    <Image
      source={uri ? { uri } : undefined}
      style={[{ width: size, height: size, borderRadius: round ? size / 2 : 4, backgroundColor: '#282828' }, style, extra]}
      contentFit="cover"
      cachePolicy={Platform.isTV ? 'disk' : 'memory-disk'}
      transition={120}
      recyclingKey={uri}
      accessible={false}
      onError={() => setFailed({ base, step: Math.min(step + 1, chain.length - 1) })}
    />
  );
  if (uri && hasLetterbox(uri)) {
    return (
      <View style={[{ width: size, height: size, overflow: 'hidden', borderRadius: round ? size / 2 : 4 }, style as object]}>
        {image({ transform: [{ scale: BAR_ZOOM }], borderRadius: 0 })}
      </View>
    );
  }
  return image();
}
