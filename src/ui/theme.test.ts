import { darkTheme } from './theme';
import { formatDuration } from '../player/format';

describe('theme', () => {
  it('uses the Spotify-like dark tokens', () => {
    expect(darkTheme.colors.background).toBe('#121212');
    expect(darkTheme.colors.accent).toBe('#1ED760');
  });
});

describe('formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(-3)).toBe('0:00');
  });
});
