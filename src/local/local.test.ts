import { fnv1a64, isLocalId, localIdFor } from './id';
import { extensionOf, fileUriIn, isAudioFileName, parseFileName, rebaseArtUri, resolveMeta, uniqueName } from './names';
import { planScan } from './plan';
import { byAddedDesc, toTrack, type LocalSong } from './track';

describe('local ids', () => {
  it('hashes like FNV-1a 64 (known vectors)', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });
  it('is stable, prefixed, colon free and 16 hex digits long', () => {
    const id = localIdFor('Album/01 Song.mp3');
    expect(id).toBe(localIdFor('Album/01 Song.mp3'));
    expect(id).toMatch(/^local-[0-9a-f]{16}$/);
    expect(localIdFor('Album/01 Song.mp3')).not.toBe(localIdFor('Album/02 Song.mp3'));
  });
  it('gives the same id for the two Unicode forms of one name', () => {
    expect(localIdFor('Café.mp3')).toBe(localIdFor('Café.mp3'));
  });
  it('tells local ids from YouTube ids', () => {
    expect(isLocalId(localIdFor('x.mp3'))).toBe(true);
    expect(isLocalId('dQw4w9WgXcQ')).toBe(false);
    expect(isLocalId('-local-1234')).toBe(false);
    expect(isLocalId(undefined)).toBe(false);
    expect(isLocalId('')).toBe(false);
  });
});

describe('file names', () => {
  it('accepts the supported audio types and ignores the rest and hidden files', () => {
    for (const n of ['a.mp3', 'a.M4A', 'a.aac', 'a.mp4', 'a.wav', 'a.aif', 'a.aiff', 'a.flac', 'a.caf', 'a.alac']) expect(isAudioFileName(n)).toBe(true);
    for (const n of ['a.txt', 'a.lrc', 'a.jpg', 'a', '.mp3', '._a.mp3', '.DS_Store', 'mp3']) expect(isAudioFileName(n)).toBe(false);
    expect(extensionOf('Song.final.MP3')).toBe('mp3');
  });
  it('reads "Artist - Title"', () => {
    expect(parseFileName('Daft Punk - Get Lucky.mp3')).toEqual({ title: 'Get Lucky', artist: 'Daft Punk' });
    expect(parseFileName('Daft Punk - Get Lucky - Radio Edit.m4a')).toEqual({ title: 'Get Lucky - Radio Edit', artist: 'Daft Punk' });
  });
  it('drops a leading track number and uses the whole name when there is no artist', () => {
    expect(parseFileName('01 - Song.mp3')).toEqual({ title: 'Song' });
    expect(parseFileName('07. Some Artist - Some Song.flac')).toEqual({ title: 'Some Song', artist: 'Some Artist' });
    expect(parseFileName('Just a name.wav')).toEqual({ title: 'Just a name' });
    expect(parseFileName('2 Pac - Changes.mp3')).toEqual({ title: 'Changes', artist: '2 Pac' });
    expect(parseFileName('7 Rings.mp3')).toEqual({ title: '7 Rings' });
  });
  it('prefers tags, then the file name, then "Unknown artist"', () => {
    expect(resolveMeta({ title: 'T', artist: 'A', album: 'Al', durationSec: 200.4 }, 'x - y.mp3')).toEqual({ title: 'T', artists: ['A'], album: 'Al', durationSec: 200 });
    expect(resolveMeta({}, 'Artist - Title.mp3')).toMatchObject({ title: 'Title', artists: ['Artist'] });
    expect(resolveMeta({ artist: ' ' }, 'Song.mp3')).toMatchObject({ title: 'Song', artists: ['Unknown artist'] });
    expect(resolveMeta({ title: 'Only title' }, 'A - B.mp3')).toMatchObject({ title: 'Only title', artists: ['A'] });
  });
});

describe('uniqueName', () => {
  it('keeps a free name', () => {
    expect(uniqueName('a.mp3', new Set(['b.mp3']))).toBe('a.mp3');
  });
  it('adds (2), (3) on a clash, ignoring case', () => {
    expect(uniqueName('a.mp3', new Set(['a.mp3']))).toBe('a (2).mp3');
    expect(uniqueName('a.mp3', new Set(['A.MP3', 'a (2).mp3']))).toBe('a (3).mp3');
  });
  it('handles a name with no extension', () => {
    expect(uniqueName('song', new Set(['song']))).toBe('song (2)');
  });
});

describe('planScan', () => {
  const file = (rel: string, size = 1, mtime = 1) => ({ rel, size, mtime });
  const known = (rel: string, size = 1, mtime = 1) => ({ [localIdFor(rel)]: { rel, size, mtime } });
  it('does nothing when nothing changed', () => {
    expect(planScan(known('a.mp3'), [file('a.mp3')])).toEqual({ read: [], remove: [] });
  });
  it('reads new files', () => {
    const p = planScan({}, [file('Sub/a.mp3')]);
    expect(p.read).toEqual([{ rel: 'Sub/a.mp3', size: 1, mtime: 1, id: localIdFor('Sub/a.mp3'), isNew: true }]);
  });
  it('re-reads a file whose size or modification time changed', () => {
    expect(planScan(known('a.mp3'), [file('a.mp3', 2)]).read.map((r) => r.isNew)).toEqual([false]);
    expect(planScan(known('a.mp3'), [file('a.mp3', 1, 9)]).read.map((r) => r.isNew)).toEqual([false]);
  });
  it('removes songs whose file is gone', () => {
    expect(planScan({ ...known('a.mp3'), ...known('b.mp3') }, [file('b.mp3')]).remove).toEqual([localIdFor('a.mp3')]);
  });
});

describe('track mapping', () => {
  const song: LocalSong = { id: 'local-1', rel: 'a.mp3', size: 1, mtime: 1, title: 'T', artists: ['A', 'B'], album: 'Al', durationSec: 100, addedAt: 5 };
  it('is an ordinary track with artwork when there is a cover', () => {
    const t = toTrack(song, 'file:///x/.music-art/c.jpg');
    expect(t).toMatchObject({ kind: 'track', id: 'local-1', title: 'T', artists: [{ name: 'A' }, { name: 'B' }], album: { id: '', name: 'Al' }, artwork: [{ url: 'file:///x/.music-art/c.jpg' }] });
    expect(toTrack({ ...song, album: undefined }).album).toBeUndefined();
    expect(toTrack(song).artwork).toEqual([]);
  });
  it('sorts newest first', () => {
    const a = { ...song, id: 'a', addedAt: 1 };
    const b = { ...song, id: 'b', addedAt: 2 };
    expect([a, b].sort(byAddedDesc).map((s) => s.id)).toEqual(['b', 'a']);
  });
  it('rebases saved artwork urls onto the current container only for our art folder', () => {
    expect(rebaseArtUri('file:///old/Documents/.music-art/x-1.jpg', 'file:///new/Documents/.music-art/')).toBe('file:///new/Documents/.music-art/x-1.jpg');
    expect(rebaseArtUri('file:///old/Documents/songs-art/x.jpg', 'file:///new/Documents/.music-art/')).toBe('file:///old/Documents/songs-art/x.jpg');
    expect(rebaseArtUri('https://i.ytimg.com/a.jpg', 'file:///new/.music-art/')).toBe('https://i.ytimg.com/a.jpg');
  });
});

describe('fileUriIn', () => {
  it('encodes brackets, spaces, # and % so iOS never re-encodes the uri', () => {
    expect(fileUriIn('file:///D/Music/', 'Song __ X [-O_Z4PwtcI4].mp3')).toBe('file:///D/Music/Song%20__%20X%20%5B-O_Z4PwtcI4%5D.mp3');
    expect(fileUriIn('file:///D/Music', 'A #1/100% (live).m4a')).toBe('file:///D/Music/A%20%231/100%25%20(live).m4a');
  });
  it('round-trips through decodeURIComponent to the real path', () => {
    const name = 'Sujan%20Chapagain [x] é.mp3';
    expect(decodeURIComponent(fileUriIn('file:///D', name))).toBe(`file:///D/${name}`);
  });
});
