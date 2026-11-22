import { leadArtist, normalizeArtist, normalizeTitle, stripArtistPrefix } from './normalize';

const cases: [string, string][] = [
  ['Blinding Lights (Official Video)', 'Blinding Lights'],
  ['Blinding Lights [Official Music Video]', 'Blinding Lights'],
  ['Shape of You (Lyrics)', 'Shape of You'],
  ['Bohemian Rhapsody - Remastered 2011', 'Bohemian Rhapsody'],
  ['Bohemian Rhapsody (Remastered 2011)', 'Bohemian Rhapsody'],
  ['Hey Jude - 2015 Remaster', 'Hey Jude'],
  ['Hotel California (Live) ', 'Hotel California'],
  ['Levitating (feat. DaBaby)', 'Levitating'],
  ['Levitating ft. DaBaby', 'Levitating'],
  ['Stay [Official Audio] [HD]', 'Stay'],
  ['Numb (Official Lyric Video)', 'Numb'],
  ['Song Title (Explicit)', 'Song Title'],
  ['Save Your Tears (Official Visualizer)', 'Save Your Tears'],
  ['Let It Be - Mono Version', 'Let It Be - Mono Version'],
  ['Yesterday (Remastered)', 'Yesterday'],
  ['Heat Waves [Lyrics]', 'Heat Waves'],
  ['Closer (Official Video) (feat. Halsey)', 'Closer'],
  ['Closer (feat. Halsey) [Official Video]', 'Closer'],
  ['Dreams - 2004 Remaster', 'Dreams'],
  ['Plain Title', 'Plain Title'],
  ['Mind (Mix) (feat. X)', 'Mind (Mix)'],
  ['Kesariya (Official Video) | Brahmastra | Ranbir Kapoor', 'Kesariya'],
  ['Raataan Lambiyan | Shershaah', 'Raataan Lambiyan'],
  ['Maya Ko Boj \uFF5C Nepali Movie', 'Maya Ko Boj'],
  ['Bhana Bhana (Audio) [HD]', 'Bhana Bhana'],
  ['Stay (Official Music Video)', 'Stay'],
  ['Stay (Lyric Video)', 'Stay'],
];

describe('normalizeTitle', () => {
  it.each(cases)('%s -> %s', (input, out) => expect(normalizeTitle(input)).toBe(out));
});

describe('artists', () => {
  it('strips Topic and VEVO', () => {
    expect(normalizeArtist('Adele - Topic')).toBe('Adele');
    expect(normalizeArtist('AdeleVEVO')).toBe('Adele');
  });
  it('takes the lead artist', () => {
    expect(leadArtist('Calvin Harris, Rihanna')).toBe('Calvin Harris');
    expect(leadArtist('Simon & Garfunkel')).toBe('Simon');
  });
  it('strips an artist prefix from the title', () => {
    expect(stripArtistPrefix('Adele - Hello', 'Adele')).toBe('Hello');
    expect(stripArtistPrefix('Hello - Remix', 'Adele')).toBe('Hello - Remix');
  });
});
