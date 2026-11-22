import { MOOD_ART_TTL_MS, moodArtFrom, moodsNeedingArt } from './moodArt';

jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));
jest.mock('../downloads/net', () => ({ isOffline: () => false }));
jest.mock('../youtube/queries', () => ({ moodPageQuery: () => ({}) }));
jest.mock('../youtube/queryClient', () => ({ queryClient: {} }));

const art = (url: string) => [{ url, width: 226, height: 226 }];

describe('moodsNeedingArt', () => {
  const moods = [
    { title: 'Chill', color: '#000', params: 'a' },
    { title: 'Focus', color: '#000', params: 'b' },
    { title: 'Party', color: '#000', params: 'c' },
    { title: 'Static', color: '#000' },
  ];
  it('asks for missing and old pictures only, never for tiles without a page', () => {
    const now = 10 * MOOD_ART_TTL_MS;
    const known = { a: { url: 'x', at: now - 1000 }, b: { url: null, at: now - MOOD_ART_TTL_MS - 1 } };
    expect(moodsNeedingArt(moods, known, now).map((m) => m.title)).toEqual(['Focus', 'Party']);
  });
});

describe('moodArtFrom', () => {
  it('takes the first item that has artwork, null when none has', () => {
    const shelves = [
      { title: 's1', items: [{ kind: 'artist', id: '1', name: 'n', artwork: [] }] },
      { title: 's2', items: [{ kind: 'playlist', id: '2', title: 't', artwork: art('https://lh3.googleusercontent.com/p=w226-h226') }] },
    ];
    expect(moodArtFrom(shelves as never)).toContain('googleusercontent');
    expect(moodArtFrom([{ title: 'e', items: [] }])).toBeNull();
  });
});
