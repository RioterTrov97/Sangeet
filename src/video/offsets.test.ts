import type { Lyrics } from '../lyrics/types';
import type { Track } from '../youtube/models';
import { decideOffset, type Deps } from './offsets';

jest.mock('../lyrics', () => ({ getLyrics: jest.fn() }));
jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => undefined }));

const song = { kind: 'track', id: 'S', title: 'Song', artists: [{ name: 'A' }], artwork: [], durationSec: 200 } as unknown as Track;
const lines = (shift: number) => ['one fine day', 'two fine days', 'three fine days', 'four fine days', 'five fine days', 'six fine days'].map((text, i) => ({ time: 10 + i * 5 + shift, text }));
const lrc = (shift: number, durationSec: number): Lyrics => ({ synced: lines(shift), source: 'LRCLIB', providerId: 'lrclib', durationSec });
const env = (n: number) => ({ sizes: Array.from({ length: n }, (_, i) => 300 + ((i * 7919) % 97)), hopSec: 0.0232, bytes: 1, requests: 1, ms: 1 });
const base = (o: Partial<Deps> = {}): Deps => ({ videoDuration: async () => 230, lyrics: async () => null, envelope: async () => { throw new Error('no audio'); }, ...o });

test('same length is 0 without any other work', async () => {
  const lyrics = jest.fn();
  const out = await decideOffset(song, 'V', base({ videoDuration: async () => 201, lyrics }));
  expect(out.entry).toMatchObject({ offset: 0, method: 'length' });
  expect(lyrics).not.toHaveBeenCalled();
});

test('lyrics are used when audio cannot tell', async () => {
  const out = await decideOffset(song, 'V', base({ lyrics: async (t) => (t.id === 'S' ? lrc(0, 200) : lrc(12, 230)) }));
  expect(out.entry).toMatchObject({ offset: 12, method: 'lyrics' });
});

test('the video lyric record must be timed for the video length', async () => {
  const out = await decideOffset(song, 'V', base({ lyrics: async (t) => (t.id === 'S' ? lrc(0, 200) : lrc(12, 200)) }));
  expect(out.entry).toBeUndefined();
});

test('YouTube lyrics for the video id are the song\'s own timeline, so they are not evidence', async () => {
  const yt: Lyrics = { synced: lines(0), source: 'YouTube Music', providerId: 'ytmusic' };
  const out = await decideOffset(song, 'V', base({ lyrics: async () => yt }));
  expect(out.entry).toBeUndefined();
});

test('audio alignment wins over lyrics and finds the lag', async () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let level = 0;
  const s = Array.from({ length: 5200 }, () => ((level = rnd() < 0.06 ? rnd() * 200 : level * 0.9), 300 + level + rnd() * 20));
  const v = [...Array.from({ length: 600 }, () => 250 + rnd() * 40), ...s];
  const out = await decideOffset(song, 'V', base({ envelope: async (id) => ({ ...env(1), sizes: id === 'S' ? s : v }), lyrics: async (t) => (t.id === 'S' ? lrc(0, 200) : lrc(5, 230)) }));
  expect(out.entry?.method).toBe('audio');
  expect(out.entry?.offset).toBeCloseTo(600 * 0.0232, 1);
});

test('nothing conclusive gives no entry', async () => {
  const out = await decideOffset(song, 'V', base());
  expect(out.entry).toBeUndefined();
  expect(out.steps.map((s) => s.method)).toEqual(['length', 'audio', 'lyrics']);
});
