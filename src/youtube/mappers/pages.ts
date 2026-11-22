import type { Album, AlbumPage, Artist, ArtistPage, MusicItem, Page, PlaylistPage, Shelf, Track } from '../models';
import { artistsFromRuns, artworkOf, browseId, pageType, textOf, type YtNode } from './common';
import { mapItem, mapItems, mapPanelVideo, mapResponsiveTrack } from './items';

const GROUP_TITLES: Record<MusicItem['kind'], string> = {
  track: 'Songs',
  album: 'Albums',
  artist: 'Artists',
  playlist: 'Playlists',
};

function mapCard(card: YtNode): MusicItem | undefined {
  const ep = card.on_tap;
  const type = pageType(ep);
  const title = textOf(card.title);
  const base = { title, artwork: artworkOf(card.thumbnail) };
  const subtitle = textOf(card.subtitle);
  if (type === 'MUSIC_PAGE_TYPE_ARTIST' && browseId(ep)) return { kind: 'artist', id: browseId(ep)!, name: title, subtitle, artwork: base.artwork };
  if (type === 'MUSIC_PAGE_TYPE_ALBUM' && browseId(ep))
    return { kind: 'album', id: browseId(ep)!, title, artists: artistsFromRuns(card.subtitle?.runs), artwork: base.artwork };
  const videoId = ep?.payload?.videoId;
  if (videoId) return { kind: 'track', id: videoId, title, artists: artistsFromRuns(card.subtitle?.runs), artwork: base.artwork };
  return undefined;
}

/** "All" search: top result card first, then the remaining rows grouped by kind (Songs, Albums, ...). */
export function mapSearchAll(search: YtNode): Shelf[] {
  const shelves: Shelf[] = [];
  const loose: MusicItem[] = [];
  for (const section of search.contents ?? []) {
    if (section.type === 'MusicCardShelf') {
      const top = mapCard(section);
      if (top) shelves.push({ title: 'Top result', items: [top] });
      const inner = mapItems(section.contents);
      if (inner.length) shelves.push({ title: 'From this artist', items: inner });
    } else if (section.type === 'MusicShelf') {
      const items = mapItems(section.contents);
      if (items.length) shelves.push({ title: textOf(section.title), items });
    } else if (section.type === 'ItemSection') {
      loose.push(...mapItems(section.contents));
    }
  }
  const seen = new Set<string>();
  for (const kind of ['track', 'album', 'artist', 'playlist'] as const) {
    const items = loose.filter((i) => i.kind === kind && !seen.has(`${i.kind}:${i.id}`));
    items.forEach((i) => seen.add(`${i.kind}:${i.id}`));
    if (items.length) shelves.push({ title: GROUP_TITLES[kind], items });
  }
  return shelves;
}

/** Items of a filtered search (one MusicShelf) or of a continuation (MusicShelfContinuation). */
export function mapSearchItems(contents: YtNode): MusicItem[] {
  const list = Array.isArray(contents) ? contents.flatMap((s: YtNode) => s.contents ?? []) : (contents?.contents ?? []);
  return mapItems(list);
}

export function mapAlbumPage(a: YtNode, albumId: string): AlbumPage {
  const h = a.header ?? {};
  const artwork = artworkOf(h.thumbnail);
  const artists = artistsFromRuns(h.strapline_text_one?.runs);
  const subtitle = textOf(h.subtitle); // "Album • 2000"
  const year = subtitle.match(/\b(\d{4})\b/)?.[1];
  const releaseType = subtitle.split('•')[0]?.trim();
  const albumRef = { id: albumId, name: textOf(h.title) };
  const tracks = (a.contents ?? [])
    .map((i: YtNode) => mapResponsiveTrack(i, { artwork, artists, album: albumRef }))
    .filter((t: Track | undefined): t is Track => !!t)
    .map((t: Track) => ({ ...t, isVideo: undefined, album: t.album ?? albumRef }));
  const album: Album = { kind: 'album', id: albumId, title: albumRef.name, artists, year, releaseType, artwork };
  return { album, tracks, description: textOf(h.description?.description) || undefined, trackCountText: textOf(h.second_subtitle) || undefined };
}

export function mapPlaylistHeader(p: YtNode, playlistId: string) {
  const h = p.header ?? {};
  const author =
    textOf(h.strapline_text_one) || textOf(h.author) || (typeof h.author?.name === 'string' ? h.author.name : undefined);
  return {
    playlist: {
      kind: 'playlist' as const,
      id: playlistId.replace(/^VL/, ''),
      title: textOf(h.title),
      author: author || undefined,
      subtitle: textOf(h.subtitle) || undefined,
      artwork: artworkOf(h.thumbnail),
    },
    description: textOf(h.description?.description) || undefined,
    countText: textOf(h.second_subtitle) || undefined,
  };
}

export function mapPlaylistTracks(items: YtNode[] | undefined): Track[] {
  return (items ?? []).map((i) => mapResponsiveTrack(i)).filter((t): t is Track => !!t);
}

export function mapArtistPage(a: YtNode, artistId: string): ArtistPage {
  const h = a.header ?? {};
  const channelId = typeof h.subscription_button?.channel_id === 'string' ? (h.subscription_button.channel_id as string) : undefined;
  const artist: Artist = { kind: 'artist', id: artistId, name: textOf(h.title), artwork: artworkOf(h.thumbnail), ...(channelId ? { channelId } : {}) };
  const page: ArtistPage = {
    artist,
    description: textOf(h.description) || undefined,
    topSongs: [],
    albums: [],
    singles: [],
    related: [],
    shelves: [],
  };
  for (const s of a.sections ?? []) {
    const title = textOf(s.title) || textOf(s.header?.title);
    const items = mapItems(s.contents);
    if (!items.length) continue;
    if (s.type === 'MusicShelf' && /top songs/i.test(title)) page.topSongs = items.filter((i): i is Track => i.kind === 'track');
    else if (/^albums$/i.test(title)) page.albums = items.filter((i): i is Album => i.kind === 'album');
    else if (/singles/i.test(title)) page.singles = items.filter((i): i is Album => i.kind === 'album');
    else if (/fans might also like|similar artists/i.test(title)) page.related = items.filter((i): i is Artist => i.kind === 'artist');
    else page.shelves.push({ title, items });
  }
  return page;
}

export function mapUpNext(panel: YtNode): Track[] {
  return (panel?.contents ?? []).map((c: YtNode) => mapPanelVideo(c?.primary ?? c)).filter((t: Track | undefined): t is Track => !!t);
}

export function mapSuggestions(sections: YtNode): string[] {
  const out: string[] = [];
  for (const s of sections ?? []) for (const c of s.contents ?? []) if (c.suggestion) out.push(textOf(c.suggestion));
  return [...new Set(out)];
}

export function mapHome(home: YtNode): Shelf[] {
  const shelves: Shelf[] = [];
  for (const s of home.sections ?? []) {
    const title = textOf(s.header?.title) || textOf(s.title);
    const items = mapItems(s.contents);
    if (items.length) shelves.push({ title, items });
  }
  return shelves;
}

export type { Page, PlaylistPage };
export { mapItem };
