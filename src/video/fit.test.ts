import { coverCrop, nextFit, resolveFit } from './fit';

const PHONE = [844, 390] as const; // landscape iPhone

describe('resolveFit', () => {
  it('auto fills a 16:9 video (small crop)', () => expect(resolveFit('auto', { width: 1920, height: 1080 }, ...PHONE)).toBe('fill'));
  it('auto fits a 4:3 video (large crop)', () => expect(resolveFit('auto', { width: 1440, height: 1080 }, ...PHONE)).toBe('fit'));
  it('auto fits a square or vertical video', () => {
    expect(resolveFit('auto', { width: 1080, height: 1080 }, ...PHONE)).toBe('fit');
    expect(resolveFit('auto', { width: 1080, height: 1920 }, ...PHONE)).toBe('fit');
  });
  it('auto fills a cinema-wide video', () => expect(resolveFit('auto', { width: 2390, height: 1000 }, ...PHONE)).toBe('fill'));
  it('auto fills while the size is unknown', () => expect(resolveFit('auto', undefined, ...PHONE)).toBe('fill'));
  it('an explicit choice wins', () => {
    expect(resolveFit('fit', { width: 1920, height: 1080 }, ...PHONE)).toBe('fit');
    expect(resolveFit('fill', { width: 1440, height: 1080 }, ...PHONE)).toBe('fill');
  });
});

describe('coverCrop', () => {
  it('is 0 for the same shape and for unknown sizes', () => {
    expect(coverCrop(844, 390, 844, 390)).toBe(0);
    expect(coverCrop(0, 0, 844, 390)).toBe(0);
  });
});

describe('nextFit', () => {
  it('cycles auto -> fill -> fit -> auto', () => expect([nextFit('auto'), nextFit('fill'), nextFit('fit')]).toEqual(['fill', 'fit', 'auto']));
});
