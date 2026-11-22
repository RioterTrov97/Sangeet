import type { Album, Artist, MusicItem, Playlist, Track } from '../models';
import {
  albumFromRuns,
  artistsFromRuns,
  artistsOf,
  artworkOf,
  browseId,
  isExplicit,
  pageType,
  parseDuration,
  parseViews,
  textOf,
  videoTypeOf,
  type YtNode,
} from './common';

function durationOf(i: YtNode): number | undefined {
  return (
    i.duration?.seconds ??
    parseDuration(textOf(i.duration)) ??
    parseDuration(textOf(i.fixed_columns?.[0]?.title)) ??
    undefined
  );
}

function subtitleRuns(i: YtNode): YtNode[] {
  return i.flex_columns?.[1]?.title?.runs ?? i.subtitle?.runs ?? [];
}

/** MusicResponsiveListItem of type song / video (album and playlist tracks, search rows, top songs). */
export function mapResponsiveTrack(i: YtNode, fallback?: { artwork?: Track['artwork']; artists?: Track['artists']; album?: Track['album'] }): Track | undefined {
  if (!i?.id) return undefined;
  const runs = subtitleRuns(i);
  let artists = artistsOf(i.artists);
  if (!artists.length) artists = artistsOf(i.authors);
  if (!artists.length) artists = artistsFromRuns(runs);
  if (!artists.length && fallback?.artists) artists = fallback.artists;
  // Plain-text artists (e.g. "Various Artists" or uploads without a channel link): take run 0 that is not a type label.
  if (!artists.length) {
    const name = runs.map((r) => r.text as string).find((t) => t && t.trim() !== '•' && !/^(Song|Video)$/.test(t) && !/^\d+(:\d{2})+$/.test(t) && !/views?$/.test(t));
    if (name) artists = [{ name }];
  }
  const album = i.album?.id ? { id: i.album.id as string, name: i.album.name as string } : (albumFromRuns(runs) ?? fallback?.album);
  const art = artworkOf(i.thumbnail);
  return {
    kind: 'track',
    id: i.id,
    title: i.title ?? textOf(i.flex_columns?.[0]?.title),
    artists,
    album,
    durationSec: durationOf(i),
    artwork: art.length ? art : (fallback?.artwork ?? []),
    explicit: isExplicit(i.badges) || undefined,
    isVideo: i.item_type === 'video' && !album ? true : undefined,
    videoType: videoTypeOf(i),
    views: runs.map((r) => parseViews(r.text as string)).find((v) => v != null),
  };
}

export function mapPanelVideo(v: YtNode): Track | undefined {
  if (!v?.video_id) return undefined;
  const artists = artistsOf(v.artists);
  return {
    kind: 'track',
    id: v.video_id,
    title: textOf(v.title),
    artists: artists.length ? artists : v.author ? [{ name: v.author }] : [],
    album: v.album?.id ? { id: v.album.id, name: v.album.name } : undefined,
    durationSec: v.duration?.seconds ?? parseDuration(textOf(v.duration)),
    artwork: artworkOf(v.thumbnail),
    explicit: isExplicit(v.badges) || undefined,
    videoType: videoTypeOf(v),
  };
}

function mapAlbum(i: YtNode): Album | undefined {
  const id = i.id ?? browseId(i.endpoint);
  if (!id) return undefined;
  const runs = subtitleRuns(i);
  const labels = runs.map((r) => r.text as string);
  const releaseType = labels.find((t) => /^(Album|Single|EP)$/.test(t));
  let artists = artistsOf(i.artists);
  if (!artists.length && i.author?.name) artists = artistsOf([i.author]);
  if (!artists.length) artists = artistsFromRuns(runs);
  return {
    kind: 'album',
    id,
    title: textOf(i.title) || (i.title as string),
    artists,
    year: i.year ?? labels.find((t) => /^\d{4}$/.test(t)),
    releaseType,
    artwork: artworkOf(i.thumbnail),
  };
}

function mapArtist(i: YtNode): Artist | undefined {
  const id = i.id ?? browseId(i.endpoint);
  const name = i.name ?? textOf(i.title) ?? i.title;
  if (!id || !name) return undefined;
  return { kind: 'artist', id, name, subtitle: textOf(i.subtitle) || undefined, artwork: artworkOf(i.thumbnail) };
}

function mapPlaylist(i: YtNode): Playlist | undefined {
  const raw: string | undefined = i.id ?? browseId(i.endpoint);
  if (!raw) return undefined;
  const runs = subtitleRuns(i);
  const author = i.author?.name ?? runs.find((r) => pageType(r.endpoint))?.text ?? i.author?.toString?.();
  return {
    kind: 'playlist',
    id: raw.replace(/^VL/, ''),
    title: textOf(i.title) || (i.title as string),
    author: typeof author === 'string' ? author : undefined,
    subtitle: textOf(i.subtitle) || undefined,
    artwork: artworkOf(i.thumbnail),
  };
}

/** Maps MusicResponsiveListItem and MusicTwoRowItem (the two card shapes) to our MusicItem. */
export function mapItem(i: YtNode): MusicItem | undefined {
  if (!i) return undefined;
  if (i.type !== 'MusicResponsiveListItem' && i.type !== 'MusicTwoRowItem') return undefined;
  switch (i.item_type) {
    case 'song':
    case 'video':
      // TwoRowItem videos have `id` too; both are playable tracks.
      return i.type === 'MusicTwoRowItem' ? mapTwoRowVideo(i) : mapResponsiveTrack(i);
    case 'album':
      return mapAlbum(i);
    case 'artist':
      return mapArtist(i);
    case 'playlist':
      return mapPlaylist(i);
    default:
      return undefined;
  }
}

function mapTwoRowVideo(i: YtNode): Track | undefined {
  // Podcast-episode cards carry a browse id (MPED...) instead of a videoId: not playable as a track.
  if (!i.id || !/^[\w-]{11}$/.test(i.id)) return undefined;
  const runs = i.subtitle?.runs ?? [];
  const artists = artistsOf(i.artists).length ? artistsOf(i.artists) : artistsFromRuns(runs);
  return {
    kind: 'track',
    id: i.id,
    title: textOf(i.title),
    artists: artists.length ? artists : i.author?.name ? [{ name: i.author.name }] : [],
    artwork: artworkOf(i.thumbnail),
    isVideo: true,
    videoType: videoTypeOf(i),
  };
}

export function mapItems(list: YtNode[] | undefined): MusicItem[] {
  return (list ?? []).map(mapItem).filter((x): x is MusicItem => !!x);
}
