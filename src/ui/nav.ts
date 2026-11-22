import { router } from 'expo-router';

import type { MusicItem } from '../youtube/models';

export const openAlbum = (id: string) => router.push({ pathname: '/album/[id]', params: { id } });
export const openArtist = (id: string) => router.push({ pathname: '/artist/[id]', params: { id } });
export const openPlaylist = (id: string) => router.push({ pathname: '/playlist/[id]', params: { id } });

export function openItem(item: MusicItem): void {
  if (item.kind === 'album') openAlbum(item.id);
  else if (item.kind === 'artist') openArtist(item.id);
  else if (item.kind === 'playlist') openPlaylist(item.id);
}
