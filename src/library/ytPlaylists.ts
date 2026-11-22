import type { MusicItem, Playlist } from '../youtube/models';

/** Auto-generated / radio playlists you cannot add songs to: liked songs (LM), episodes (SE), radios (RD...), album and artist radios (OLAK5uy..., RDCLAK...). */
const isAutoPlaylist = (id: string): boolean => id === 'LM' || id === 'SE' || id === 'WL' || id.startsWith('RD') || id.startsWith('OLAK') || id.startsWith('VL');

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The account's YouTube Music playlists a song can be added to, from the synced library rows. `ytKeys` are the `kind-id` keys of rows that
 * came from YouTube (saved_collections source 'yt'). Prefers playlists the user owns (author matches the account name); when the author or
 * the name is unknown, or nothing matches, falls back to ids that look like user playlists (`PL...`).
 */
export function addableYtPlaylists(saved: MusicItem[], ytKeys: string[], accountName?: string): Playlist[] {
  const yt = new Set(ytKeys);
  const all = saved.filter((x): x is Playlist => x.kind === 'playlist' && yt.has(`playlist-${x.id}`) && !isAutoPlaylist(x.id));
  const me = accountName ? norm(accountName) : '';
  if (me) {
    const owned = all.filter((p) => p.author && norm(p.author).includes(me));
    if (owned.length) return owned;
  }
  return all.filter((p) => p.id.startsWith('PL'));
}
