import { bestPlaylist, mapIntent, similarity, type SiriContext, type SiriIntentInput } from './mapIntent';

const ctx: SiriContext = {
  playlists: [
    { id: 'l1', name: 'Gym Mix', source: 'local' },
    { id: 'l2', name: 'Late Night Drive', source: 'local' },
    { id: 'PLabc', name: 'Chill Hindi Classics', source: 'yt' },
  ],
  offline: false,
  hasCurrent: true,
  hasDownloads: true,
  hasLiked: true,
};

const map = (i: SiriIntentInput, c: Partial<SiriContext> = {}) => mapIntent(i, { ...ctx, ...c });

describe('mapIntent (utterance-shaped cases)', () => {
  it('"play some music" -> shuffle Liked', () => {
    expect(map({})).toEqual({ kind: 'playLiked', shuffle: true, mode: 'replace' });
  });
  it('"play my music" -> shuffle Liked', () => {
    expect(map({ mediaName: 'my music', reference: 'my' })).toMatchObject({ kind: 'playLiked', shuffle: true });
  });
  it('"play something" offline -> shuffle Downloads', () => {
    expect(map({ mediaName: 'something' }, { offline: true })).toMatchObject({ kind: 'playDownloads', shuffle: true });
  });
  it('offline with no downloads -> offline failure', () => {
    expect(map({ mediaName: 'Yellow' }, { offline: true, hasDownloads: false })).toEqual({ kind: 'fail', code: 'offline' });
  });
  it('offline song only matches downloads', () => {
    expect(map({ mediaName: 'Yellow', artistName: 'Coldplay' }, { offline: true })).toMatchObject({ kind: 'playDownloads', query: 'Yellow Coldplay' });
  });
  it('"play my Gym Mix playlist" -> local playlist', () => {
    expect(map({ mediaName: 'gym mix', mediaType: 'playlist' })).toMatchObject({ kind: 'playPlaylist', playlist: { id: 'l1' } });
  });
  it('fuzzy playlist name ("late night drives") matches', () => {
    expect(map({ mediaName: 'late night drives', mediaType: 'playlist' })).toMatchObject({ kind: 'playPlaylist', playlist: { id: 'l2' } });
  });
  it('YT playlist by name', () => {
    expect(map({ mediaName: 'chill hindi classics' })).toMatchObject({ kind: 'playPlaylist', playlist: { source: 'yt', id: 'PLabc' } });
  });
  it('shuffle flag is passed to the playlist', () => {
    expect(map({ mediaName: 'Gym Mix', mediaType: 'playlist', playShuffled: true })).toMatchObject({ kind: 'playPlaylist', shuffle: true });
  });
  it('album with artist -> top album search', () => {
    expect(map({ mediaName: 'Parachutes', artistName: 'Coldplay', mediaType: 'album' })).toMatchObject({ kind: 'searchPlay', searchType: 'album', query: 'Parachutes Coldplay', radio: false });
  });
  it('artist only -> artist top songs then radio', () => {
    expect(map({ artistName: 'The Weeknd', mediaType: 'artist' })).toMatchObject({ kind: 'searchPlay', searchType: 'artist', query: 'The Weeknd', radio: true });
  });
  it('song with artist -> top song then radio', () => {
    expect(map({ mediaName: 'Yellow', artistName: 'Coldplay', mediaType: 'song' })).toMatchObject({ kind: 'searchPlay', searchType: 'song', query: 'Yellow Coldplay', radio: true });
  });
  it('song only', () => {
    expect(map({ mediaName: 'Blinding Lights' })).toMatchObject({ kind: 'searchPlay', searchType: 'song', query: 'Blinding Lights' });
  });
  it('genre or mood -> mood browse', () => {
    expect(map({ genreNames: ['Jazz'] })).toEqual({ kind: 'browseMood', query: 'Jazz', shuffle: false, mode: 'replace' });
    expect(map({ moodNames: ['chill'] })).toMatchObject({ kind: 'browseMood', query: 'chill' });
  });
  it('"play more like this" -> radio from current', () => {
    expect(map({ reference: 'currentlyPlaying' })).toEqual({ kind: 'radioFromCurrent', mode: 'replace' });
  });
  it('"play more like this" with nothing playing fails', () => {
    expect(map({ reference: 'currentlyPlaying' }, { hasCurrent: false })).toEqual({ kind: 'fail', code: 'noMatch' });
  });
  it('"play X next" / "later" insert into the queue', () => {
    expect(map({ mediaName: 'Yellow', queueLocation: 'next' })).toMatchObject({ mode: 'next' });
    expect(map({ mediaName: 'Yellow', queueLocation: 'later' })).toMatchObject({ mode: 'later' });
  });
  it('a playlist-typed request with no match falls back to a search', () => {
    expect(map({ mediaName: 'Brand New Mix', mediaType: 'playlist' })).toMatchObject({ kind: 'searchPlay' });
  });
});

describe('similarity', () => {
  it('ignores case, punctuation and filler words', () => {
    expect(similarity('the gym mix', 'Gym Mix')).toBe(1);
    expect(similarity("late night drive's", 'Late Night Drive')).toBeGreaterThan(0.8);
    expect(similarity('Banana', 'Gym Mix')).toBeLessThan(0.4);
  });
  it('bestPlaylist honours the threshold', () => {
    expect(bestPlaylist('xyz', ctx.playlists)).toBeUndefined();
  });
});
