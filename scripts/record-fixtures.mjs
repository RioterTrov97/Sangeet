// Records raw InnerTube responses used by the mapper tests. Usage: node scripts/record-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { Innertube } from 'youtubei.js';

const out = new URL('../src/youtube/__fixtures__/', import.meta.url);
let current = null;
const captured = {};
const realFetch = globalThis.fetch;
const capture = async (input, init) => {
  const res = await realFetch(input, init);
  const url = typeof input === 'string' ? input : input.url;
  if (current && /youtubei\/v1\/(search|browse|next|music\/get_search_suggestions)/.test(url)) {
    const json = await res.clone().json();
    delete json.responseContext; // contains visitor data
    captured[current] = json;
  }
  return res;
};

const yt = await Innertube.create({ fetch: capture, retrieve_player: false, generate_session_locally: true });
const rec = async (name, fn) => { current = name; const r = await fn(); current = null; return r; };

const q = 'coldplay';
const songs = await rec('search_songs', () => yt.music.search(q, { type: 'song' }));
await rec('search_all', () => yt.music.search(q));
const albums = await rec('search_albums', () => yt.music.search(q, { type: 'album' }));
const artists = await rec('search_artists', () => yt.music.search(q, { type: 'artist' }));
const playlists = await rec('search_playlists', () => yt.music.search(q, { type: 'playlist' }));
await rec('search_videos', () => yt.music.search(q, { type: 'video' }));
await rec('suggestions', () => yt.music.getSearchSuggestions('cold'));
await rec('album', () => yt.music.getAlbum(albums.albums.contents[0].id));
await rec('artist', () => yt.music.getArtist(artists.artists.contents[0].id));
await rec('playlist', () => yt.music.getPlaylist(playlists.playlists.contents[0].id));
await rec('up_next', () => yt.music.getUpNext(songs.songs.contents[0].id));
await rec('home', () => yt.music.getHomeFeed());

for (const [k, v] of Object.entries(captured)) writeFileSync(new URL(`${k}.json`, out), JSON.stringify(v));
console.log(Object.keys(captured).join(' '), 'albumId', albums.albums.contents[0].id);
