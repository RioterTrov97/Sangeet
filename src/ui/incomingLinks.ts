import { router } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';

import { shareIntent } from '../../modules/share-intent';
import { playMusicLink } from '../link/playLink';
import { parseShared } from '../link/shared';
import { log, logWarn } from '../util/log';
import { showNotice } from '../util/notice';
import { openSpotifyImportFor } from './SpotifyImport';

const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/** Acts on a link or share text: plays a YouTube / YouTube Music song, album or playlist, opens an artist, or starts a Spotify import. */
export function openSharedText(text: string): void {
  const target = parseShared(text);
  log('link', `shared -> ${target ? target.kind : 'not understood'}`);
  if (!target) return showNotice("Sangeet can't open that link");
  if (target.kind === 'spotify') return openSpotifyImportFor(target.text);
  const { link } = target;
  if (link.kind === 'artist') return void router.push({ pathname: '/artist/[id]', params: { id: link.id } });
  showNotice('Starting playback from YouTube Music…');
  playMusicLink(link)
    .then(() => router.push('/player'))
    .catch((e) => {
      logWarn('link', 'could not play shared link', e instanceof Error ? e.message : e);
      showNotice("Couldn't play that link");
    });
}

/**
 * Android only: links shared to Sangeet (ACTION_SEND, native module) and links opened from a browser or another app
 * (ACTION_VIEW through expo-linking). Mounted once in the root layout; the TV has its own handler (src/tv/openMusicLink.ts).
 */
export function useIncomingLinks(): void {
  useEffect(() => {
    if (Platform.OS !== 'android' || Platform.isTV) return;
    const initial = shareIntent?.getInitial();
    if (initial) openSharedText(initial);
    void Linking.getInitialURL().then((u) => u && isWebLink(u) && openSharedText(u));
    const share = shareIntent?.addListener('onShare', (e) => openSharedText(e.text));
    const view = Linking.addEventListener('url', ({ url }) => isWebLink(url) && openSharedText(url));
    return () => {
      share?.remove();
      view.remove();
    };
  }, []);
}
