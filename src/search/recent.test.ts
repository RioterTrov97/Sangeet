import { addRecent, removeRecent } from './recent';

describe('recent searches', () => {
  it('puts the newest first and dedupes case-insensitively', () => {
    expect(addRecent(['b', 'Adele', 'c'], 'adele')).toEqual(['adele', 'b', 'c']);
  });
  it('trims, collapses spaces and ignores empty', () => {
    expect(addRecent([], '  hello   world ')).toEqual(['hello world']);
    expect(addRecent(['a'], '   ')).toEqual(['a']);
  });
  it('caps at 20', () => {
    let l: string[] = [];
    for (let i = 0; i < 25; i++) l = addRecent(l, `q${i}`);
    expect(l).toHaveLength(20);
    expect(l[0]).toBe('q24');
  });
  it('removes one entry', () => expect(removeRecent(['a', 'B', 'c'], 'b')).toEqual(['a', 'c']));
});
