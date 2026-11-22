import { downloadedTracks } from '../downloads/manager';
import { isOffline } from '../downloads/net';
import { libraryState, localPlaylistTracks } from '../library/store';
import { addToQueue, fillRadio, playNext, playTracks } from '../player';
import { playerState } from '../player/store';
import { log, logWarn } from '../util/log';
import { getAlbum, getArtist, getMoodPage, getMoods, getPlaylist, search } from '../youtube/api';
import type { MusicItem, Track } from '../youtube/models';
import { bestPlaylist, mapIntent, resultFor, similarity, type PlaylistRef, type QueueMode, type SiriAction, type SiriContext, type SiriIntentInput, type SiriResultCode } from './mapIntent';

/** Searches are remembered so CarPlay can offer "Recent searches". Set by the search screen. */
export function siriContext(): SiriContext {
  const lib = libraryState();
  const playlists: PlaylistRef[] = [
    ...lib.playlists.map((p) => ({ id: p.id, name: p.name, source: 'local' as const })),
    ...lib.saved.filter((s): s is Extract<MusicItem, { kind: 'playlist' }> => s.kind === 'playlist').map((p) => ({ id: p.id, name: p.title, source: 'yt' as const })),
  ];
  const downloads = downloadedTracks();
  return { playlists, offline: isOffline(), hasCurrent: !!playerState().queue[playerState().index], hasDownloads: downloads.length > 0, hasLiked: lib.liked.length > 0 };
}

async function begin(tracks: Track[], mode: QueueMode, shuffle: boolean, sourceName?: string): Promise<boolean> {
  if (!tracks.length) return false;
  if (mode === 'replace') await playTracks(tracks, 0, { source: 'siri', sourceName, shuffle });
  else if (mode === 'next') for (const t of [...tracks].reverse()) await playNext(t);
  else for (const t of tracks) await addToQueue(t);
  return true;
}

async function allTracks(page: { items: Track[]; next?: () => Promise<any> }, max = 4): Promise<Track[]> {
  const out = [...page.items];
  let p: typeof page | undefined = page;
  for (let i = 0; i < max && p?.next; i++) {
    p = await p.next();
    if (p) out.push(...p.items);
  }
  return out;
}

export async function runAction(a: SiriAction): Promise<boolean> {
  switch (a.kind) {
    case 'fail':
      return false;
    case 'playLiked': {
      const liked = libraryState().liked;
      if (liked.length) return begin(liked, a.mode, a.shuffle, 'Liked Songs');
      return begin(downloadedTracks(), a.mode, a.shuffle, 'Downloads'); // nothing liked yet: use downloads
    }
    case 'playDownloads': {
      let t = downloadedTracks();
      if (a.query) {
        const q = a.query;
        t = t.filter((x) => similarity(q, `${x.title} ${x.artists.map((r) => r.name).join(' ')}`) > 0.35 || [x.title, ...x.artists.map((r) => r.name), x.album?.name ?? ''].some((s) => s && similarity(q, s) > 0.6));
      }
      return begin(t, a.mode, a.shuffle, 'Downloads');
    }
    case 'playPlaylist': {
      const tracks = a.playlist.source === 'local' ? localPlaylistTracks(a.playlist.id) : await allTracks((await getPlaylist(a.playlist.id)).tracks);
      return begin(tracks, a.mode, a.shuffle, a.playlist.name);
    }
    case 'searchPlay': {
      const page = await search(a.query, a.searchType);
      const top = page.items[0];
      if (!top) return false;
      if (top.kind === 'track') return begin([top], a.mode, a.shuffle);
      if (top.kind === 'album') {
        const al = await getAlbum(top.id);
        return begin(al.tracks, a.mode, a.shuffle, al.album.title);
      }
      if (top.kind === 'artist') {
        const ar = await getArtist(top.id);
        return begin(ar.topSongs, a.mode, a.shuffle, ar.artist.name);
      }
      return false;
    }
    case 'browseMood': {
      const moods = await getMoods().catch(() => []);
      const mood = moods.filter((m) => m.params).sort((x, y) => similarity(a.query, y.title) - similarity(a.query, x.title))[0];
      if (mood?.params && similarity(a.query, mood.title) > 0.6) {
        const shelves = await getMoodPage(mood.params);
        const pl = shelves.flatMap((s) => s.items).find((i): i is Extract<MusicItem, { kind: 'playlist' }> => i.kind === 'playlist');
        if (pl) return begin(await allTracks((await getPlaylist(pl.id)).tracks, 1), a.mode, a.shuffle, pl.title);
      }
      const found = (await search(`${a.query} music`, 'playlist')).items.find((i) => i.kind === 'playlist');
      return found ? begin(await allTracks((await getPlaylist(found.id)).tracks, 1), a.mode, a.shuffle, a.query) : false;
    }
    case 'radioFromCurrent':
      await fillRadio();
      return true;
  }
}

/** Handles one intent end to end and returns the code Siri should speak about. */
export async function handleSiriIntent(input: SiriIntentInput): Promise<SiriResultCode> {
  const action = mapIntent(input, siriContext());
  log('siri', `intent ${JSON.stringify(input)} -> ${action.kind}${'query' in action && action.query ? ` "${action.query}"` : ''}`);
  try {
    const ok = await runAction(action);
    log('siri', `result ${ok ? 'ok' : 'failed'}`);
    return resultFor(ok, action);
  } catch (e) {
    logWarn('siri', 'handler failed', e instanceof Error ? e.message : e);
    return 'failure';
  }
}

export { bestPlaylist };
