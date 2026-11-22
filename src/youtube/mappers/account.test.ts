import { flattenHistory, mapRecap, parseAccountItem, parseAccountMenu } from './account';

const menu = {
  actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: {
    accountName: { runs: [{ text: 'Test User' }] },
    channelHandle: { runs: [{ text: '@testuser' }] },
    accountPhoto: { thumbnails: [{ url: 'https://yt3.ggpht.com/x=s48', width: 48, height: 48 }, { url: 'https://yt3.ggpht.com/x=s88', width: 88, height: 88 }] },
  } } } } } }],
};

describe('account', () => {
  it('finds the active account header anywhere and picks the largest photo', () => {
    expect(parseAccountMenu(menu)).toEqual({ name: 'Test User', handle: '@testuser', photo: 'https://yt3.ggpht.com/x=s88' });
  });
  it('returns null when signed out', () => {
    expect(parseAccountMenu({ actions: [] })).toBeNull();
    expect(parseAccountMenu(undefined)).toBeNull();
  });
  it('accepts simpleText names and no handle', () => {
    expect(parseAccountMenu({ a: { activeAccountHeaderRenderer: { accountName: { simpleText: 'Test User' } } } })).toEqual({ name: 'Test User' });
  });
  it('parses the account item fallback', () => {
    expect(parseAccountItem({ account_name: { text: 'Test User' }, channel_handle: { text: '@testuser' }, account_photo: [{ url: 'https://yt3.ggpht.com/x=s88', width: 88, height: 88 }] })).toEqual({ name: 'Test User', handle: '@testuser', photo: 'https://yt3.ggpht.com/x=s88' });
    expect(parseAccountItem({})).toBeNull();
  });
});

describe('history flatten', () => {
  it('handles empty input', () => {
    expect(flattenHistory(undefined)).toEqual([]);
    expect(flattenHistory([{ contents: [] }])).toEqual([]);
  });
  it('keeps page order, dedupes by id and caps', () => {
    const item = (id: string) => ({ id, title: id });
    const shelves = [{ contents: [item('a'), item('b')] }, { contents: [item('b'), item('c')] }];
    expect(flattenHistory(shelves).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(flattenHistory(shelves, 2).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('recap', () => {
  it('is null for a message-only page', () => {
    expect(mapRecap({ sections: [{ message: {} }] })).toBeNull();
    expect(mapRecap(undefined)).toBeNull();
  });
  it('reads the header title', () => {
    expect(mapRecap({ header: { title: { text: 'Your Recap' } }, sections: [] })?.title).toBe('Your Recap');
  });
});
