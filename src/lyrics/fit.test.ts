import { fitsDuration } from './fit';

const lines = (...t: number[]) => t.map((time) => ({ time, text: `l${time}` }));

describe('fitsDuration', () => {
  it('uses the declared lyric duration (8 s tolerance)', () => {
    expect(fitsDuration(lines(10, 200), 218, 220)).toBe(true);
    expect(fitsDuration(lines(10, 200), 218, 226)).toBe(true);
    expect(fitsDuration(lines(10, 200), 218, 279)).toBe(false); // Tadha: video is 60 s longer than the song
  });
  it('falls back to the last timestamp', () => {
    expect(fitsDuration(lines(10, 200), undefined, 218)).toBe(true);
    expect(fitsDuration(lines(10, 300), undefined, 218)).toBe(false); // runs past the end
    expect(fitsDuration(lines(10, 205), undefined, 279)).toBe(false); // ends 74 s early
  });
  it('unknown lengths fit', () => {
    expect(fitsDuration(lines(10, 300), undefined, 0)).toBe(true);
    expect(fitsDuration(undefined, 100, 300)).toBe(true);
  });
});
