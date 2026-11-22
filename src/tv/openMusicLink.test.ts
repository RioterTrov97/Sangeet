/* eslint-disable import/first */
jest.mock('../util/log', () => ({ log: () => {}, logWarn: () => {} }));
jest.mock('../youtube/api', () => ({ getAlbum: jest.fn(), getPlaylist: jest.fn(), getUpNext: jest.fn() }));
jest.mock('../player', () => ({ playTracks: jest.fn(async () => {}) }));
jest.mock('../player/store', () => ({ playerState: () => ({ queue: [], index: 0 }) }));
const mockNav = { stack: [{ name: 'home' }] as { name: string; id?: string }[], root: jest.fn(), push: jest.fn() };
jest.mock('./nav', () => ({ tvNav: () => mockNav }));

import { playTracks } from '../player';
import { useHostUi } from '../remote/hostUi';
import * as api from '../youtube/api';
import type { Track } from '../youtube/models';
import { remoteWakeActive } from './activity';
import { openMusicLink } from './openMusicLink';

const t = (id: string, title = id): Track => ({ kind: 'track', id, title, artists: [{ name: 'A' }], artwork: [] });
const ID = (n: number) => `video${String(n).padStart(6, '0')}`; // 11 characters, like a real videoId
const flush = () => new Promise((r) => setTimeout(r, 0));
const play = playTracks as jest.Mock;
const wrap = (url: string) => `sangeet://open?url=${encodeURIComponent(url)}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockNav.stack = [{ name: 'home' }];
  useHostUi.setState({ toast: undefined, starting: undefined });
});

it('plays a song on its own as radio, on Now Playing', async () => {
  (api.getUpNext as jest.Mock).mockResolvedValue([t(ID(1), 'Yellow'), t(ID(2))]);
  openMusicLink(wrap(`https://music.youtube.com/watch?v=${ID(1)}&si=x`));
  expect(mockNav.root).toHaveBeenCalledWith({ name: 'now' });
  expect(useHostUi.getState().starting?.from).toBe('YouTube Music');
  expect(remoteWakeActive()).toBe(true);
  await flush();
  expect(play).toHaveBeenCalledWith([t(ID(1), 'Yellow')], 0, { source: `radio:${ID(1)}`, sourceName: 'Yellow radio' });
  expect(useHostUi.getState().toast?.text).toBe('Playing from YouTube Music');
});

it('starts a song link at its t= time', async () => {
  (api.getUpNext as jest.Mock).mockResolvedValue([t(ID(1), 'Yellow')]);
  openMusicLink(wrap(`https://music.youtube.com/watch?v=${ID(1)}&t=75`));
  await flush();
  expect(play).toHaveBeenCalledWith([t(ID(1), 'Yellow')], 0, { source: `radio:${ID(1)}`, sourceName: 'Yellow radio', startAt: 75 });
});

it('plays the list a song was opened from, starting at that song, paging until it is found', async () => {
  const page2 = { items: [t(ID(3)), t(ID(4))] };
  (api.getPlaylist as jest.Mock).mockResolvedValue({ playlist: { title: 'Parachutes' }, tracks: { items: [t(ID(1)), t(ID(2))], next: async () => page2 } });
  openMusicLink(wrap(`https://music.youtube.com/watch?v=${ID(3)}&list=OLAK5uy_abc`));
  await flush();
  await flush();
  expect(play).toHaveBeenCalledWith([t(ID(1)), t(ID(2)), t(ID(3)), t(ID(4))], 2, { source: 'playlist:OLAK5uy_abc', sourceName: 'Parachutes' });
});

it('falls back to the song alone when it is not in the list or the list fails', async () => {
  (api.getUpNext as jest.Mock).mockResolvedValue([t(ID(9), 'Solo')]);
  (api.getPlaylist as jest.Mock).mockRejectedValue(new Error('private'));
  openMusicLink(`https://music.youtube.com/watch?v=${ID(9)}&list=PLprivate`);
  await flush();
  await flush();
  expect(play).toHaveBeenCalledWith([t(ID(9), 'Solo')], 0, { source: `radio:${ID(9)}`, sourceName: 'Solo radio' });
});

it('plays albums and playlists from the top', async () => {
  (api.getAlbum as jest.Mock).mockResolvedValue({ album: { title: 'Parachutes' }, tracks: [t(ID(1)), t(ID(2))] });
  openMusicLink(wrap('https://music.youtube.com/browse/MPREb_oBucXyijinj'));
  await flush();
  expect(play).toHaveBeenLastCalledWith([t(ID(1)), t(ID(2))], 0, { source: 'album:MPREb_oBucXyijinj', sourceName: 'Parachutes' });
  (api.getPlaylist as jest.Mock).mockResolvedValue({ playlist: { title: 'Lofi' }, tracks: { items: [t(ID(5))] } });
  openMusicLink(wrap('https://music.youtube.com/playlist?list=PLW12P-BRHlHj13okeC2vmYvvxPfjqIJ8a'));
  await flush();
  await flush();
  expect(play).toHaveBeenLastCalledWith([t(ID(5))], 0, { source: 'playlist:PLW12P-BRHlHj13okeC2vmYvvxPfjqIJ8a', sourceName: 'Lofi' });
});

it('opens the artist page for an artist link, without starting playback', () => {
  openMusicLink(wrap('https://music.youtube.com/channel/UCIaFw5VBEK8qaW6nRpx_qnw'));
  expect(mockNav.push).toHaveBeenCalledWith({ name: 'artist', id: 'UCIaFw5VBEK8qaW6nRpx_qnw' });
  expect(mockNav.root).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
});

it('says so when a link cannot be played, and clears the loading view when loading fails', async () => {
  openMusicLink(wrap('https://music.youtube.com/explore'));
  expect(useHostUi.getState().toast?.text).toBe("Sangeet can't open that link");
  expect(mockNav.root).not.toHaveBeenCalled();
  (api.getAlbum as jest.Mock).mockRejectedValue(new Error('offline'));
  openMusicLink(wrap('https://music.youtube.com/browse/MPREb_oBucXyijinj'));
  await flush();
  expect(useHostUi.getState().starting).toBeUndefined();
  expect(useHostUi.getState().toast?.text).toBe("Couldn't play that YouTube Music link");
});
