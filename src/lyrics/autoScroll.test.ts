import { autoScroll, AUTO_FROM, AUTO_TO, baseScroll, correctionFor, getCorrection, setCorrection } from './autoScroll';

describe('plain lyrics auto-scroll', () => {
  it('stays at the top during the intro, reaches the end at 95 %, and is linear in between', () => {
    expect(baseScroll(0.05 * 200, 200, 1000)).toBe(0);
    expect(baseScroll(AUTO_FROM * 200, 200, 1000)).toBe(0);
    expect(baseScroll(AUTO_TO * 200, 200, 1000)).toBeCloseTo(1000);
    expect(baseScroll(199, 200, 1000)).toBe(1000);
    expect(baseScroll(((AUTO_FROM + AUTO_TO) / 2) * 200, 200, 1000)).toBeCloseTo(500);
  });
  it('does nothing without a duration or content to scroll', () => {
    expect(baseScroll(50, 0, 1000)).toBe(0);
    expect(baseScroll(50, 200, 0)).toBe(0);
    expect(baseScroll(NaN, 200, 1000)).toBe(0);
  });
  it('a drag becomes a correction that keeps the pace, and a seek moves the scroll', () => {
    const dur = 200;
    const maxY = 1000;
    const pos = 100;
    const base = baseScroll(pos, dur, maxY);
    const c = correctionFor(base + 150, pos, dur, maxY); // the user scrolled 150 px ahead
    expect(autoScroll(pos, dur, maxY, c)).toBeCloseTo(base + 150);
    const later = baseScroll(120, dur, maxY);
    expect(autoScroll(120, dur, maxY, c)).toBeCloseTo(later + 150); // same pace afterwards
    expect(autoScroll(0, dur, maxY, 0)).toBe(0); // seek to the start
    expect(autoScroll(190, dur, maxY, 500)).toBe(maxY); // clamped
    expect(autoScroll(20, dur, maxY, -900)).toBe(0);
  });
  it('keeps corrections per song', () => {
    setCorrection('a', 40);
    expect(getCorrection('a')).toBe(40);
    expect(getCorrection('b')).toBe(0);
    expect(getCorrection(undefined)).toBe(0);
  });
});
