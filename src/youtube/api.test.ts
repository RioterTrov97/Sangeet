import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Innertube } from 'youtubei.js/react-native';

import { pickMoods, moodShelf } from '../home/discover';
import { FALLBACK_MOODS, channelIdOf, getMoodPage, getSession, homeMorePage, parseCharts, parseExplore, regionFromLocale, getAlbum, getArtist, getHome, parseMoods, getPlaylist, getSearchSuggestions, getUpNext, search, searchAll, setSessionForTests } from './api';
import type { Mood } from './api';
import type { Track } from './models';

jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {}, storage: { getString: () => undefined, set: () => {}, remove: () => {} } }));


const fixture = (n: string) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${n}.json`), 'utf8'));
async function use(name: string) {
  const yt = await Innertube.create({
    retrieve_player: false,
    generate_session_locally: true,
    fetch: (async () => new Response(JSON.stringify(fixture(name)))) as typeof fetch,
  });
  setSessionForTests(yt as never);
}
beforeAll(() => void jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => setSessionForTests(undefined));

const expectTrack = (t: Track) => {
  expect(t.kind).toBe('track');
  expect(t.id).toMatch(/^[\w-]{11}$/);
  expect(t.title).toBeTruthy();
};

describe('mappers on recorded fixtures', () => {
  it('searchAll: top result and grouped rows', async () => {
    await use('search_all');
    const shelves = await searchAll('x');
    expect(shelves[0].title).toBe('Top result');
    expect(shelves[0].items[0]).toMatchObject({ kind: 'artist', name: 'Coldplay' });
    expect(shelves.map((s) => s.title)).toContain('Songs');
  });

  it('search songs', async () => {
    await use('search_songs');
    const page = await search('x', 'song');
    expect(page.items.length).toBeGreaterThan(5);
    const t = page.items[0] as Track;
    expectTrack(t);
    expect(t.artists[0].name).toBe('Coldplay');
    expect(t.album?.id).toMatch(/^MPREb_/);
    expect(t.durationSec).toBeGreaterThan(30);
  });

  it('search albums / artists / playlists / videos', async () => {
    await use('search_albums');
    expect((await search('x', 'album')).items[0]).toMatchObject({ kind: 'album', title: 'Parachutes', year: '2000' });
    await use('search_artists');
    expect((await search('x', 'artist')).items[0]).toMatchObject({ kind: 'artist' });
    await use('search_playlists');
    const pl = (await search('x', 'playlist')).items[0];
    expect(pl).toMatchObject({ kind: 'playlist' });
    expect(pl.id.startsWith('VL')).toBe(false);
    await use('search_videos');
    const v = (await search('x', 'video')).items[0] as Track;
    expectTrack(v);
    expect(v.artists.length).toBeGreaterThan(0);
  });

  it('album page: tracks inherit album artwork, artist and album ref', async () => {
    await use('album');
    const page = await getAlbum('MPREb_oBucXyijinj');
    expect(page.album).toMatchObject({ title: 'Parachutes', year: '2000' });
    expect(page.tracks).toHaveLength(10);
    page.tracks.forEach(expectTrack);
    expect(page.tracks[0].artists[0].name).toBe('Coldplay');
    expect(page.tracks[0].artwork.length).toBeGreaterThan(0);
    expect(page.tracks[0].album?.id).toBe('MPREb_oBucXyijinj');
    expect(page.tracks[0].durationSec).toBeGreaterThan(30);
  });

  it('artist page: top songs, albums, singles, related', async () => {
    await use('artist');
    const page = await getArtist('UCIaFw5VBEK8qaW6nRpx_qnw');
    expect(page.artist.name).toBe('Coldplay');
    expect(page.topSongs.length).toBeGreaterThan(0);
    expect(page.albums.length).toBeGreaterThan(0);
    expect(page.singles.length).toBeGreaterThan(0);
    expect(page.related.length).toBeGreaterThan(0);
  });

  it('playlist page', async () => {
    await use('playlist');
    const page = await getPlaylist('PLgaFNC_I_ZklJBOcKQK8fxQEdSxuDhSBP');
    expect(page.playlist.title).toContain('Coldplay');
    expect(page.tracks.items.length).toBeGreaterThan(10);
    page.tracks.items.forEach(expectTrack);
  });

  it('up next', async () => {
    await use('up_next');
    const tracks = await getUpNext('GOrADSEKb_k');
    expect(tracks.length).toBeGreaterThan(20);
    expect(tracks[0].id).toBe('GOrADSEKb_k');
    tracks.forEach(expectTrack);
    // YouTube Music's song / official video / upload label is read for every radio item.
    expect(tracks.filter((t) => t.videoType).length).toBe(tracks.length);
  });

  it('video type labels on search results', async () => {
    await use('search_songs');
    const songs = (await search('x', 'song')).items as Track[];
    expect(songs.every((t) => t.videoType === 'song')).toBe(true);
    await use('search_videos');
    const vids = (await search('x', 'video')).items as Track[];
    expect(vids.length).toBeGreaterThan(3);
    expect(vids.every((t) => t.videoType === 'official' || t.videoType === 'ugc')).toBe(true);
  });

  it('suggestions and home', async () => {
    await use('suggestions');
    expect((await getSearchSuggestions('cold'))[0]).toBeTruthy();
    await use('home');
    const home = await getHome();
    expect(home.length).toBeGreaterThan(0);
    expect(home[0].items.length).toBeGreaterThan(0);
  });
});

describe('moods', () => {
  const tile = (text: string, argb: number, params?: string) => ({
    musicNavigationButtonRenderer: { buttonText: { runs: [{ text }] }, solid: { leftStripeColor: argb }, clickCommand: { browseEndpoint: { browseId: 'FEmusic_moods_and_genres_category', params } } },
  });
  const page = (items: unknown[]) => ({ contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ gridRenderer: { items } }] } } } }] } } });

  it('parseMoods keeps tiles with browse params and drops the rest', () => {
    const moods = parseMoods(page([tile('Chill', 4288988671, 'ggMPabc'), tile('Broken', 4288988671), { other: 1 }]));
    expect(moods).toEqual([{ title: 'Chill', color: expect.stringMatching(/^#[0-9a-f]{6}$/), browseId: 'FEmusic_moods_and_genres_category', params: 'ggMPabc' }]);
  });

  it('parseMoods returns [] for an unrecognised shape', () => {
    expect(parseMoods({ contents: {} })).toEqual([]);
    expect(parseMoods(undefined)).toEqual([]);
  });

  it('fallback tiles all carry browse params so they still open the mood page', () => {
    expect(FALLBACK_MOODS.length).toBeGreaterThan(10);
    for (const m of FALLBACK_MOODS) expect(m.params).toMatch(/^ggMP/);
  });
});

describe('explore (charts / new releases)', () => {
  const ex = parseExplore(fixture('explore'));
  it('Trending becomes a ranked track list', () => {
    expect(ex.topSongs.length).toBeGreaterThanOrEqual(10);
    ex.topSongs.forEach(expectTrack);
    expect(ex.topSongs[0].artists.length).toBeGreaterThan(0);
  });
  it('new releases are albums with ids and artwork', () => {
    expect(ex.newReleases.length).toBeGreaterThan(5);
    expect(ex.newReleases[0]).toMatchObject({ kind: 'album' });
    expect(ex.newReleases[0].id).toMatch(/^MPREb_/);
    expect(ex.newReleases[0].artwork.length).toBeGreaterThan(0);
  });
  it('new music videos are tracks', () => {
    expect(ex.videos.length).toBeGreaterThan(5);
    ex.videos.forEach(expectTrack);
  });
  it('region from locale', () => {
    expect(regionFromLocale('en-AU')).toBe('AU');
    expect(regionFromLocale('hi_IN')).toBe('IN');
    expect(regionFromLocale('zh-Hans-CN')).toBe('CN');
    expect(regionFromLocale('en')).toBeUndefined();
    expect(regionFromLocale(undefined)).toBeUndefined();
  });
});

describe('home discovery parsers', () => {
  it('explore: new albums and singles are split by release type', () => {
    const ex = parseExplore(fixture('explore'));
    expect(ex.newAlbums.length + ex.newSingles.length).toBe(ex.newReleases.length);
    expect(ex.newSingles.length).toBeGreaterThan(0);
    ex.newSingles.forEach((a) => expect(['Single', 'EP']).toContain(a.releaseType));
    ex.newAlbums.forEach((a) => expect(['Single', 'EP']).not.toContain(a.releaseType));
  });

  it('charts: top artists (circles) and chart playlists', () => {
    const c = parseCharts(fixture('charts'));
    expect(c.artists.length).toBeGreaterThan(10);
    expect(c.artists[0]).toMatchObject({ kind: 'artist' });
    expect(c.artists[0].id).toMatch(/^UC/);
    expect(c.artists[0].artwork.length).toBeGreaterThan(0);
    expect(c.playlists.length).toBeGreaterThan(0);
    expect(c.playlists[0].id.startsWith('VL')).toBe(false);
  });

  it('charts: an unrelated page yields nothing', () => {
    expect(parseCharts(fixture('explore'))).toEqual({ artists: [], playlists: [] });
  });

  it('mood page: playlist carousels merge into one titled shelf', async () => {
    await use('mood_chill');
    const shelves = await getMoodPage('ggMPOg1uX1JOQWZFeDByc2Jm');
    const s = moodShelf('Chill', shelves)!;
    expect(s.title).toBe('Chill');
    expect(s.items.length).toBeGreaterThan(6);
    expect(s.items.every((i) => i.kind === 'playlist')).toBe(true);
    expect(new Set(s.items.map((i) => i.id)).size).toBe(s.items.length);
  });

  it('pickMoods: region genre first, then Chill / Workout / Party, capped', () => {
    const tile = (title: string): Mood => ({ title, color: '', params: title });
    const all = ['Chill', 'Party', 'Workout', 'Bollywood & Indian', 'K-Pop', 'Pop'].map(tile);
    expect(pickMoods(all, 'IN').map((m) => m.title)).toEqual(['Bollywood & Indian', 'Chill', 'Workout', 'Party']);
    expect(pickMoods(all, 'KR', 3).map((m) => m.title)).toEqual(['K-Pop', 'Chill', 'Workout']);
    expect(pickMoods(all, 'US').map((m) => m.title)).toEqual(['Chill', 'Workout', 'Party']);
    expect(pickMoods(FALLBACK_MOODS, 'IN').map((m) => m.title)).toEqual(['Chill', 'Workout', 'Party']);
    expect(pickMoods([], 'IN')).toEqual([]);
  });

  it('home more: pages continuation shelves and stops when there is no more', async () => {
    await use('home');
    const feed: any = await (await getSession()).music.getHomeFeed();
    const second = { sections: feed.sections.slice(0, 2), has_continuation: false };
    const first = { has_continuation: true, getContinuation: async () => ({ ...second, has_continuation: true, getContinuation: async () => second }) };
    const p1 = await homeMorePage(first);
    expect(p1.items.length).toBeGreaterThan(0);
    expect(p1.next).toBeDefined();
    const p2 = await p1.next!();
    expect(p2.items.length).toBeGreaterThan(0);
    expect(p2.next).toBeUndefined();
    expect((await homeMorePage({ has_continuation: false })).items).toEqual([]);
  });

  it('artist page carries the channel id for subscribing', async () => {
    await use('artist');
    const page = await getArtist('UCIaFw5VBEK8qaW6nRpx_qnw');
    expect(page.artist.channelId).toMatch(/^UC/);
    expect(channelIdOf(page.artist)).toBe(page.artist.channelId);
    expect(channelIdOf({ id: 'UCDPM_n1atn2ijUwHd0NNRQw' })).toBe('UCDPM_n1atn2ijUwHd0NNRQw');
    expect(channelIdOf({ id: 'MPLAxyz' })).toBeUndefined();
  });
});
