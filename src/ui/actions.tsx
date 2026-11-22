import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from './Icon';
import { Alert, Share } from 'react-native';

import { isSignedIn, syncYtLibrary, useAuth } from '../auth/store';
import { addableYtPlaylists } from '../library/ytPlaylists';
import { removeAutoCached, isAutoCached, autoCachedTracks } from '../downloads/autoCache';
import { downloadedGroups, downloadTracks, getDownloadRow, removeDownload, retryDownload, downloadedTracks, type GroupInfo } from '../downloads/manager';
import { togglePin, isPinned } from '../library/pins';
import { deleteLocalSong, isLocalId, localTracks } from '../local';
import { importSongsFromFiles } from '../local/import';
import {
  addToLocalPlaylist,
  createLocalPlaylist,
  deleteLocalPlaylist,
  isFollowing,
  isLiked,
  libraryState,
  localPlaylistTracks,
  renameLocalPlaylist,
  sortLocalPlaylist,
  toggleFollow,
  toggleLike,
  toggleSaved,
  type LocalPlaylist,
  type SavedItem,
} from '../library/store';
import { addToQueue, playNext, playTracks } from '../player';
import { playerState } from '../player/store';
import { knownVideoId } from '../video/counterpart';
import { watchVideo } from '../video/controller';
import { isPlayerOpen } from './playerOpen';
import { showNotice } from '../util/notice';
import { addToYtPlaylist, createYtPlaylist, getAlbum, getArtist, getPlaylist } from '../youtube/api';
import { queryClient } from '../youtube/queryClient';
import type { Artwork, MusicItem, Track } from '../youtube/models';
import { itemSubtitle, itemTitle } from './itemText';
import { openAlbum, openArtist } from './nav';
import { confirmAction, openActionSheet, type SheetAction, type SheetHeader, type SheetPage } from './sheet';
import { DEVICE, FILES_NOTE, FROM_FILES, ON_THIS_DEVICE } from '../local/wording';

/** Anything a Library / Search row can be: a YT item, a local playlist, or the two built-in tiles. */
export type Entry = MusicItem | { kind: 'local'; pl: LocalPlaylist } | { kind: 'liked' } | { kind: 'downloads' } | { kind: 'device' };

export const entryKey = (e: Entry): string => (e.kind === 'local' ? `local-${e.pl.id}` : e.kind === 'liked' || e.kind === 'downloads' || e.kind === 'device' ? e.kind : `${e.kind}-${e.id}`);
/** The player `source` string playTracks is started with for this entry (what "current source" compares against). */
export const entrySource = (e: Entry): string => (e.kind === 'local' ? `local:${e.pl.id}` : e.kind === 'liked' || e.kind === 'downloads' || e.kind === 'device' ? e.kind : `${e.kind}:${e.id}`);
export const entryTitle = (e: Entry): string => (e.kind === 'local' ? e.pl.name : e.kind === 'liked' ? 'Liked Songs' : e.kind === 'downloads' ? 'Downloads' : e.kind === 'device' ? ON_THIS_DEVICE : itemTitle(e));

const MAX_PLAYLIST_TRACKS = 500;

/** Every track of an entry (all pages of a playlist). Throws when it cannot be loaded. */
export async function loadTracks(e: Entry): Promise<Track[]> {
  switch (e.kind) {
    case 'track': return [e];
    case 'liked': return libraryState().liked;
    case 'downloads': return [...downloadedTracks(), ...autoCachedTracks()];
    case 'device': return localTracks();
    case 'local': return localPlaylistTracks(e.pl.id);
    case 'album': return (await queryClient.fetchQuery({ queryKey: ['yt', 'album', e.id], queryFn: () => getAlbum(e.id), staleTime: 3600_000 })).tracks;
    case 'artist': return (await queryClient.fetchQuery({ queryKey: ['yt', 'artist', e.id], queryFn: () => getArtist(e.id), staleTime: 3600_000 })).topSongs;
    case 'playlist': {
      const first = await getPlaylist(e.id);
      let page = first.tracks;
      const all = [...page.items];
      while (page.next && all.length < MAX_PLAYLIST_TRACKS) {
        page = await page.next();
        all.push(...page.items);
      }
      return all;
    }
  }
}

async function withTracks(e: Entry, run: (tracks: Track[]) => void | Promise<void>): Promise<void> {
  try {
    const tracks = await loadTracks(e);
    if (!tracks.length) return void showNotice('Nothing to play here yet');
    await run(tracks);
  } catch {
    showNotice(`Couldn't load "${entryTitle(e)}"`);
  }
}

export const playEntry = (e: Entry, shuffle = false) =>
  withTracks(e, (tracks) => playTracks(tracks, 0, { source: entrySource(e), sourceName: entryTitle(e), shuffle }));
const queueEntry = (e: Entry, next: boolean) =>
  withTracks(e, async (tracks) => {
    if (!playerState().queue.length) return playTracks(tracks, 0, { source: entrySource(e), sourceName: entryTitle(e) });
    if (next) for (const t of [...tracks].reverse()) await playNext(t);
    else for (const t of tracks) await addToQueue(t);
    showNotice(next ? 'Playing next' : 'Added to queue');
  });

const groupOf = (e: Entry): GroupInfo | undefined =>
  e.kind === 'album' || e.kind === 'playlist' ? { kind: e.kind, id: e.id, name: entryTitle(e) } : e.kind === 'local' ? { kind: 'playlist', id: `local:${e.pl.id}`, name: e.pl.name } : e.kind === 'liked' ? { kind: 'liked', id: 'liked', name: 'Liked Songs' } : undefined;
const hasDownloads = (e: Entry): boolean => {
  const g = groupOf(e);
  return !!g && downloadedGroups().some((d) => d.kind === g.kind && d.id === g.id);
};
const downloadAll = (e: Entry) =>
  withTracks(e, (all) => {
    const tracks = all.filter((t) => !isLocalId(t.id)); // songs from this iPhone are already on it
    if (!tracks.length) return void showNotice(`Already on this ${DEVICE}`);
    downloadTracks(tracks, groupOf(e));
    showNotice(`Downloading ${tracks.length} song${tracks.length === 1 ? '' : 's'}`);
  });
const removeDownloads = (e: Entry) => withTracks(e, (tracks) => tracks.forEach((t) => removeDownload(t.id)));

export const shareLink = (e: Entry): string | undefined => {
  switch (e.kind) {
    case 'track': return `https://music.youtube.com/watch?v=${e.id}`;
    case 'album': return `https://music.youtube.com/browse/${e.id}`;
    case 'playlist': return `https://music.youtube.com/playlist?list=${e.id}`;
    case 'artist': return `https://music.youtube.com/channel/${e.id}`;
    default: return undefined;
  }
};

const share = (e: Entry) => {
  if (e.kind === 'local') {
    const lines = localPlaylistTracks(e.pl.id).map((t, i) => `${i + 1}. ${t.title} - ${t.artists.map((a) => a.name).join(', ')}`);
    return void Share.share({ message: [e.pl.name, '', ...lines].join('\n') });
  }
  const link = shareLink(e);
  const text = e.kind === 'track' ? `${e.title} - ${e.artists.map((a) => a.name).join(', ')}` : entryTitle(e);
  if (link) void Share.share({ message: `${text}\n${link}` });
};

// ---- headers ----

const gradientTile = (icon: 'heart.fill' | 'arrow.down.circle.fill' | 'iphone', colors: [string, string]) => (
  <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={icon} size={24} tintColor="#fff" />
  </LinearGradient>
);

export function entryHeader(e: Entry): SheetHeader {
  switch (e.kind) {
    case 'liked': return { title: 'Liked Songs', subtitle: `Playlist • ${libraryState().liked.length} songs`, tile: gradientTile('heart.fill', ['#4500F5', '#8E8CF5']) };
    case 'downloads': return { title: 'Downloads', subtitle: 'Songs saved on this device', tile: gradientTile('arrow.down.circle.fill', ['#1f6f43', '#1ED760']) };
    case 'device': return { title: ON_THIS_DEVICE, subtitle: `${localTracks().length} ${FROM_FILES}`, tile: gradientTile('iphone', ['#33415C', '#7D8CC4']) };
    case 'local': return { title: e.pl.name, subtitle: `Playlist • ${e.pl.count} song${e.pl.count === 1 ? '' : 's'}`, art: e.pl.art[0] as Artwork[] | undefined };
    default: return { title: itemTitle(e), subtitle: itemSubtitle(e), art: e.artwork, round: e.kind === 'artist' };
  }
}

// ---- add to playlist ----

export function addToPlaylistPage(getTracks: () => Promise<Track[]>, suggestedName: string): SheetPage {
  const add = async (id: string, name: string) => {
    try {
      const n = addToLocalPlaylist(id, await getTracks());
      showNotice(n ? `Added ${n} song${n === 1 ? '' : 's'} to ${name}` : `Already in ${name}`);
    } catch {
      showNotice("Couldn't load the songs");
    }
  };
  const addYt = async (id: string, name: string) => {
    try {
      const tracks = await getTracks();
      if (!tracks.some((t) => !isLocalId(t.id))) return void showNotice('Songs from this phone can only go in playlists on this phone');
      const n = await addToYtPlaylist(id, tracks.map((t) => t.id));
      void queryClient.invalidateQueries({ queryKey: ['yt', 'inf-playlist', id] });
      showNotice(`Added ${n} song${n === 1 ? '' : 's'} to ${name}`);
    } catch {
      showNotice(`Couldn't add to ${name}`);
    }
  };
  const newLocal = () =>
    Alert.prompt('New playlist', undefined, async (name) => {
      if (!name?.trim()) return;
      try {
        const tracks = await getTracks();
        createLocalPlaylist(name, tracks);
        showNotice(`Created ${name.trim()}`);
      } catch {
        showNotice("Couldn't load the songs");
      }
    }, 'plain-text', suggestedName);
  const newYt = () =>
    Alert.prompt('New playlist on YouTube Music', undefined, async (name) => {
      if (!name?.trim()) return;
      try {
        const tracks = await getTracks();
        if (!tracks.some((t) => !isLocalId(t.id))) return void showNotice('Songs from this phone can only go in playlists on this phone');
        await createYtPlaylist(name, tracks.map((t) => t.id));
        showNotice(`Created ${name.trim()} on YouTube Music`);
        void syncYtLibrary();
      } catch {
        showNotice("Couldn't create the playlist");
      }
    }, 'plain-text', suggestedName);
  const signedIn = isSignedIn();
  const { saved, ytKeys } = libraryState();
  const ytLists = signedIn ? addableYtPlaylists(saved, ytKeys, useAuth.getState().account?.name) : [];
  const local = libraryState().playlists.map((p): SheetAction => ({ id: `pl:${p.id}`, label: p.name, icon: 'music.note.list', onPress: () => add(p.id, p.name) }));
  return {
    title: 'Add to playlist',
    actions: [
      signedIn
        ? {
            id: 'newpl',
            label: 'New playlist…',
            icon: 'plus',
            sub: {
              title: 'New playlist',
              actions: [
                { id: 'newpl:yt', label: 'On YouTube Music', icon: 'music.note.list', onPress: newYt },
                { id: 'newpl:local', label: 'On this phone', icon: 'iphone', onPress: newLocal },
              ],
            },
          }
        : { id: 'newpl', label: 'New playlist…', icon: 'plus', onPress: newLocal },
      ...ytLists.map((p): SheetAction => ({ id: `ytpl:${p.id}`, label: `${p.title} (YouTube Music)`, icon: 'music.note.list', onPress: () => addYt(p.id, p.title) })),
      ...local,
    ],
  };
}

// ---- track sheet ----

export function trackActions(track: Track): SheetAction[] {
  const liked = isLiked(track.id);
  const row = getDownloadRow(track.id);
  const auto = isAutoCached(track.id);
  const album = track.album;
  const artistId = track.artists.find((a) => a.id)?.id;
  const local = isLocalId(track.id);
  const download: SheetAction[] = local
    ? [] // already a file on this iPhone
    : row?.state === 'done'
      ? [{ id: 'undl', label: 'Remove download', icon: 'trash', onPress: () => removeDownload(track.id) }]
      : row?.state === 'failed'
        ? [{ id: 'retry', label: 'Retry download', icon: 'arrow.clockwise', onPress: () => retryDownload(track.id) }]
        : row
          ? []
          : auto
            ? [
                { id: 'keep', label: 'Keep on this device', icon: 'arrow.down.circle', onPress: () => void downloadTracks([track]) },
                { id: 'unauto', label: 'Remove saved copy', icon: 'trash', onPress: () => removeAutoCached(track.id) },
              ]
            : [{ id: 'dl', label: 'Download', icon: 'arrow.down.circle', onPress: () => void downloadTracks([track]) }];
  return [
    { id: 'like', label: liked ? 'Remove from Liked Songs' : 'Save in library', icon: liked ? 'heart.fill' : 'heart', onPress: () => void toggleLike(track) },
    { id: 'next', label: 'Play next', icon: 'text.line.first.and.arrowtriangle.forward', onPress: () => void playNext(track) },
    { id: 'queue', label: 'Add to queue', icon: 'text.badge.plus', onPress: () => void addToQueue(track) },
    ...(knownVideoId(track) ? [{ id: 'watch', label: 'Watch video', icon: 'play.rectangle.fill' as const, onPress: () => {
      void watchVideo(track);
      if (!isPlayerOpen()) router.push('/player');
    } }] : []),
    ...download,
    ...(album?.id ? [{ id: 'album', label: 'View album', icon: 'square.stack' as const, onPress: () => openAlbum(album.id) }] : []),
    ...(artistId ? [{ id: 'artist', label: 'View artist', icon: 'person.circle' as const, onPress: () => openArtist(artistId) }] : []),
    { id: 'addpl', label: 'Add to playlist', icon: 'music.note.list', sub: addToPlaylistPage(async () => [track], track.title) },
    ...(local
      ? [
          confirmAction({
            id: 'rmlocal',
            label: `Delete from ${DEVICE}`,
            icon: 'trash',
            title: `Delete "${track.title}"?`,
            text: FILES_NOTE,
            confirmLabel: 'Delete',
            onConfirm: () => {
              if (isLiked(track.id)) toggleLike(track);
              deleteLocalSong(track.id);
            },
          }),
        ]
      : [
          { id: 'radio', label: 'Song radio', icon: 'dot.radiowaves.left.and.right' as const, onPress: () => void playTracks([track], 0, { source: `radio:${track.id}`, sourceName: `${track.title} radio` }) },
          { id: 'share', label: 'Share', icon: 'square.and.arrow.up' as const, onPress: () => share(track) },
        ]),
  ];
}

export function trackSheet(track: Track, fallbackArt?: Artwork[]): void {
  openActionSheet({
    header: { title: track.title, subtitle: track.artists.map((a) => a.name).join(', '), art: track.artwork.length ? track.artwork : fallbackArt },
    actions: trackActions(track),
  });
}

// ---- collection / artist / local playlist sheet ----

export function entryActions(e: Entry, opts: { library?: boolean } = {}): SheetAction[] {
  const pin: SheetAction[] = opts.library
    ? [{ id: 'pin', label: isPinned(entryKey(e)) ? 'Unpin' : 'Pin to top', icon: isPinned(entryKey(e)) ? 'pin.slash' : 'pin', onPress: () => void togglePin(entryKey(e)) }]
    : [];
  const play: SheetAction = { id: 'play', label: 'Play', icon: 'play.fill', onPress: () => void playEntry(e) };
  const shuffle: SheetAction = { id: 'shuffle', label: 'Shuffle', icon: 'shuffle', onPress: () => void playEntry(e, true) };
  const dl: SheetAction[] = hasDownloads(e)
    ? [{ id: 'undl', label: 'Remove downloads', icon: 'trash', onPress: () => void removeDownloads(e) }, { id: 'dl', label: 'Download all', icon: 'arrow.down.circle', onPress: () => void downloadAll(e) }]
    : [{ id: 'dl', label: 'Download all', icon: 'arrow.down.circle', onPress: () => void downloadAll(e) }];
  switch (e.kind) {
    case 'artist': {
      const following = isFollowing(e.id);
      return [
        { id: 'radio', label: 'Play radio', icon: 'dot.radiowaves.left.and.right', onPress: () => void playEntry(e) },
        { id: 'follow', label: following ? 'Unfollow' : 'Follow', icon: following ? 'person.badge.minus' : 'person.badge.plus', onPress: () => void toggleFollow(e) },
        ...pin,
        { id: 'share', label: 'Share', icon: 'square.and.arrow.up', onPress: () => share(e) },
      ];
    }
    case 'album':
    case 'playlist': {
      const saved = libraryState().saved.some((x) => x.kind === e.kind && x.id === e.id);
      return [
        play,
        shuffle,
        { id: 'next', label: 'Play next', icon: 'text.line.first.and.arrowtriangle.forward', onPress: () => void queueEntry(e, true) },
        { id: 'queue', label: 'Add to queue', icon: 'text.badge.plus', onPress: () => void queueEntry(e, false) },
        { id: 'save', label: saved ? 'Remove from library' : 'Save to library', icon: saved ? 'heart.fill' : 'heart', onPress: () => toggleSaved(e as SavedItem) },
        ...dl,
        { id: 'addpl', label: 'Add to playlist', icon: 'music.note.list', sub: addToPlaylistPage(() => loadTracks(e), entryTitle(e)) },
        ...pin,
        { id: 'share', label: 'Share', icon: 'square.and.arrow.up', onPress: () => share(e) },
      ];
    }
    case 'local': {
      const pl = e.pl;
      const sortBy = (by: 'title' | 'artist') => () => sortLocalPlaylist(pl.id, by);
      return [
        play,
        shuffle,
        { id: 'rename', label: 'Rename', icon: 'pencil', onPress: () => Alert.prompt('Rename playlist', undefined, (n) => n?.trim() && renameLocalPlaylist(pl.id, n), 'plain-text', pl.name) },
        { id: 'add', label: 'Add songs', icon: 'plus', onPress: () => router.push('/(tabs)/search' as never) },
        { id: 'sort', label: 'Sort tracks', icon: 'arrow.up.arrow.down', sub: { title: 'Sort tracks', actions: [{ id: 'st', label: 'By title', icon: 'textformat', onPress: sortBy('title') }, { id: 'sa', label: 'By artist', icon: 'person', onPress: sortBy('artist') }] } },
        ...dl,
        ...pin,
        { id: 'share', label: 'Share as text', icon: 'square.and.arrow.up', onPress: () => share(e) },
        confirmAction({ id: 'delete', label: 'Delete', icon: 'trash', title: `Delete "${pl.name}"?`, text: 'The songs stay in your library; only this playlist is removed.', confirmLabel: 'Delete playlist', onConfirm: () => deleteLocalPlaylist(pl.id) }),
      ];
    }
    case 'liked': return [play, shuffle, ...dl, ...pin];
    case 'downloads': return [play, shuffle, ...pin];
    case 'device': return [play, shuffle, { id: 'import', label: 'Import songs', icon: 'square.and.arrow.down', afterGone: true, onPress: () => void importSongsFromFiles() }, ...pin];
    default: return [];
  }
}

/** The ⋯ sheet for a Library / Search / Home row that is not a single song. */
export function entrySheet(e: Entry, opts: { library?: boolean } = {}): void {
  if (e.kind === 'track') return trackSheet(e);
  openActionSheet({ header: entryHeader(e), actions: entryActions(e, opts) });
}

/** Any search / shelf item: songs get the track sheet, the rest the collection sheet. */
export const itemSheet = (item: MusicItem, opts: { library?: boolean } = {}) => entrySheet(item, opts);
