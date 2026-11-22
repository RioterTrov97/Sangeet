import { moodIcon, tileShapes } from './moodTileArt';

test('icon keyword mapping with fallback', () => {
  expect(moodIcon('Hip-Hop')).toBe('mic.fill');
  expect(moodIcon('Rock')).toBe('guitars.fill');
  expect(moodIcon('Sleep')).toBe('moon.zzz.fill');
  expect(moodIcon('Bollywood')).toBe('globe.asia.australia.fill');
  expect(moodIcon('Zzz unknown')).toBe('music.note');
});

test('shapes are deterministic per title and vary between titles', () => {
  expect(tileShapes('Pop', '#d6336c')).toEqual(tileShapes('Pop', '#d6336c'));
  expect(tileShapes('Pop', '#d6336c')[0].d).not.toEqual(tileShapes('Jazz', '#d6336c')[0].d);
  const n = tileShapes('Pop', '#d6336c').length;
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(3);
});
