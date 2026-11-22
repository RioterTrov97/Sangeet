import { androidBrowseBody, lyricsBrowseId, parseTimedLyrics } from './ytTimed';

const resp = (lines: [string, string][]) => ({ contents: { elementRenderer: { model: { timedLyricsModel: { lyricsData: { timedLyricsData: lines.map(([t, l], i) => ({ lyricLine: l, cueRange: { startTimeMilliseconds: t, endTimeMilliseconds: String(Number(t) + 1000), metadata: { id: String(i) } } })) } } } } } });

describe('timed YouTube Music lyrics', () => {
  it('parses lines, in seconds and in order', () => {
    const r = parseTimedLyrics(resp([['5280', 'second'], ['1100', 'first'], ['9000', '  ']]));
    expect(r).toEqual([{ time: 1.1, text: 'first' }, { time: 5.28, text: 'second' }]);
  });
  it('returns undefined for plain-only responses', () => {
    expect(parseTimedLyrics({ contents: { description: { runs: [{ text: 'words' }] } } })).toBeUndefined();
    expect(parseTimedLyrics(resp([['0', 'only one']]))).toBeUndefined();
    expect(parseTimedLyrics(null)).toBeUndefined();
  });
  it('finds the lyrics tab and builds the Android request', () => {
    expect(lyricsBrowseId({ tabs: [{ endpoint: { browseEndpoint: { browseId: 'MPLYt_abc-1' } } }] })).toBe('MPLYt_abc-1');
    expect(lyricsBrowseId({})).toBeUndefined();
    expect(androidBrowseBody('MPLYt_x').context.client.clientName).toBe('ANDROID_MUSIC');
  });
});
