import { playTracks } from '../player';
import { log, logWarn } from '../util/log';
import { getAlbum, getPlaylist, getUpNext } from '../youtube/api';
import type { Page, Track } from '../youtube/models';
import type { MusicLink } from './musicLink';

/** Same cap as the playlist screen pulls in the background before Play. */
const MAX_TRACKS = 300;

/** Pages of a playlist until `until` is satisfied or the cap is reached. */
async function collect(page: Page<Track>, until: (tracks: Track[]) => boolean = () => false): Promise<Track[]> {
  let tracks = page.items;
  let next = page.next;
  while (next && tracks.length < MAX_TRACKS && !until(tracks)) {
    const p = await next();
    tracks = [...tracks, ...p.items];
    next = p.next;
  }
  return tracks.slice(0, MAX_TRACKS);
}

/** The song's own details (title, artists, artwork) from the up-next panel, which starts with the song itself. */
async function songTrack(videoId: string): Promise<Track> {
  const first = (await getUpNext(videoId))[0];
  if (first && first.id === videoId) return first;
  // The panel led with another version (e.g. the audio track of a video): keep the requested video, borrow the details.
  if (!first) throw new Error(`no details for ${videoId}`);
  return { ...first, id: videoId };
}

export async function playMusicLink(link: Exclude<MusicLink, { kind: 'artist' }>): Promise<void> {
  switch (link.kind) {
    case 'album': {
      const { album, tracks } = await getAlbum(link.id);
      if (!tracks.length) throw new Error('empty album');
      await playTracks(tracks, 0, { source: `album:${link.id}`, sourceName: album.title });
      return;
    }
    case 'playlist': {
      const pl = await getPlaylist(link.id);
      const tracks = await collect(pl.tracks);
      if (!tracks.length) throw new Error('empty playlist');
      await playTracks(tracks, 0, { source: `playlist:${link.id}`, sourceName: pl.playlist.title });
      return;
    }
    case 'song': {
      // Opened from a playlist or album: play that list from this song, like pressing the song on its page.
      if (link.list) {
        try {
          const pl = await getPlaylist(link.list);
          const tracks = await collect(pl.tracks, (t) => t.some((x) => x.id === link.videoId));
          const i = tracks.findIndex((t) => t.id === link.videoId);
          if (i >= 0) return void (await playTracks(tracks, i, { source: `playlist:${link.list}`, sourceName: pl.playlist.title, ...(link.at ? { startAt: link.at } : {}) }));
          log('link', `song ${link.videoId} not in ${link.list}: playing it on its own`);
        } catch (e) {
          logWarn('link', `list ${link.list} failed, playing the song on its own`, e instanceof Error ? e.message : e);
        }
      }
      // On its own it continues as radio (the player tops every queue up with related songs).
      const t = await songTrack(link.videoId);
      await playTracks([t], 0, { source: `radio:${t.id}`, sourceName: `${t.title} radio`, ...(link.at ? { startAt: link.at } : {}) });
    }
  }
}
