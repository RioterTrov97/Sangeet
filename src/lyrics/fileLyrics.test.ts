import { lyricsFromLrcFile } from './fileLyrics';

describe('lyricsFromLrcFile', () => {
  it('turns timed lines into synced lyrics', () => {
    const l = lyricsFromLrcFile('[ar:A]\n[00:01.00]one\n[00:05.00]two');
    expect(l?.providerId).toBe('file');
    expect(l?.synced?.map((x) => [x.time, x.text])).toEqual([[1, 'one'], [5, 'two']]);
  });
  it('shows a file without timestamps as plain text, without the tag lines', () => {
    expect(lyricsFromLrcFile('[ti:Song]\nline one\n\nline two')?.plain).toBe('line one\nline two');
  });
  it('is null for an empty file', () => {
    expect(lyricsFromLrcFile('  \n')).toBeNull();
  });
});
