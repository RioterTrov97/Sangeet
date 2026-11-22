import type { MusicItem } from '../youtube/models';

export const itemTitle = (it: MusicItem): string => (it.kind === 'artist' ? it.name : it.title);

/** One-line caption under a card / row title. */
export function itemSubtitle(item: MusicItem): string | undefined {
  switch (item.kind) {
    case 'track':
      return item.artists.map((a) => a.name).join(', ') || undefined;
    case 'album':
      return [item.releaseType ?? 'Album', item.artists.map((a) => a.name).join(', '), item.year].filter(Boolean).join(' • ');
    case 'artist':
      return item.subtitle ?? 'Artist';
    case 'playlist':
      return ['Playlist', item.author].filter(Boolean).join(' • ') || item.subtitle;
  }
}
