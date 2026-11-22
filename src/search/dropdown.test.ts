import { buildDropdownRows } from './dropdown';

describe('buildDropdownRows', () => {
  it('empty field lists recents, none means no dropdown', () => {
    expect(buildDropdownRows('  ', ['a', 'b'], ['x'])).toEqual([{ kind: 'recent', text: 'a' }, { kind: 'recent', text: 'b' }]);
    expect(buildDropdownRows('', [], undefined)).toEqual([]);
  });
  it('typing puts the typed text first, then suggestions', () => {
    expect(buildDropdownRows('ado', ['r'], ['adobe', 'adore'])).toEqual([
      { kind: 'typed', text: 'ado' },
      { kind: 'suggestion', text: 'adobe' },
      { kind: 'suggestion', text: 'adore' },
    ]);
  });
  it('skips the typed row when a suggestion equals it, and dedupes', () => {
    expect(buildDropdownRows('Adele', [], ['adele', 'Adele', 'adele live'])).toEqual([
      { kind: 'suggestion', text: 'adele' },
      { kind: 'suggestion', text: 'adele live' },
    ]);
  });
  it('typing with no suggestions still offers the typed text', () => {
    expect(buildDropdownRows('zz', [], undefined)).toEqual([{ kind: 'typed', text: 'zz' }]);
  });
  it('caps recents at 3 and typing rows at 5', () => {
    expect(buildDropdownRows('', ['a', 'b', 'c', 'd', 'e'], undefined).map((r) => r.text)).toEqual(['a', 'b', 'c']);
    expect(buildDropdownRows('q', [], ['1', '2', '3', '4', '5', '6']).map((r) => r.text)).toEqual(['q', '1', '2', '3', '4']);
    expect(buildDropdownRows('', ['a', 'b', 'c', 'd'], undefined, 4)).toHaveLength(4);
  });
});
