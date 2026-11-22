/** Our own domain types. Everything outside `src/youtube` uses only these, never youtubei.js types. */

export type Artwork = { url: string; width?: number; height?: number };
export type ArtistRef = { id?: string; name: string };
export type AlbumRef = { id: string; name: string };

export type Track = {
  kind: 'track';
  /** YouTube videoId. */
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef;
  durationSec?: number;
  artwork: Artwork[];
  explicit?: boolean;
  /** True for non-"Song" uploads (music videos, user uploads). */
  isVideo?: boolean;
  /** YouTube Music's own label: 'song' (official audio), 'official' (the artist's music video), 'ugc' (someone else's upload: covers, fan videos, re-uploads). */
  videoType?: VideoType;
  /** View count of a video result ("1.2M views" parsed); only set where YouTube Music shows it (video search rows). */
  views?: number;
};

export type VideoType = 'song' | 'official' | 'ugc';

export type Album = {
  kind: 'album';
  /** Browse id (MPREb_...). */
  id: string;
  title: string;
  artists: ArtistRef[];
  year?: string;
  /** "Album" | "Single" | "EP" when known. */
  releaseType?: string;
  artwork: Artwork[];
};

export type Artist = {
  kind: 'artist';
  id: string;
  name: string;
  subtitle?: string;
  artwork: Artwork[];
  /** YouTube channel id (UC...), used to subscribe. Present when read from the artist page header. */
  channelId?: string;
};

export type Playlist = {
  kind: 'playlist';
  /** Playlist id without the "VL" browse prefix. */
  id: string;
  title: string;
  author?: string;
  subtitle?: string;
  artwork: Artwork[];
};

export type MusicItem = Track | Album | Artist | Playlist;

export type Shelf = { title: string; items: MusicItem[] };

/** A page of results plus a lazy `next` (not serializable, so paged queries are not persisted). */
export type Page<T> = { items: T[]; next?: () => Promise<Page<T>> };

export type AlbumPage = { album: Album; tracks: Track[]; description?: string; trackCountText?: string };
export type PlaylistPage = { playlist: Playlist; description?: string; countText?: string; tracks: Page<Track> };
export type ArtistPage = {
  artist: Artist;
  description?: string;
  topSongs: Track[];
  albums: Album[];
  singles: Album[];
  related: Artist[];
  /** Remaining shelves (videos, playlists, ...) in page order. */
  shelves: Shelf[];
};

export type SearchType = 'song' | 'album' | 'artist' | 'playlist' | 'video';
