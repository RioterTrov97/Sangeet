import { circleFill, EMPTY_TONES, emptyMetrics, GHOST_ROWS, withAlpha } from './emptyTones';

describe('emptyTones', () => {
  it('has the spec colours', () => {
    expect(EMPTY_TONES.liked.color).toBe('#E05A8A');
    expect(EMPTY_TONES.downloads.color).toBe('#3FBF7F');
    expect(EMPTY_TONES.playlist.color).toBe('#8B7CF6');
    expect(EMPTY_TONES.neutral.color).toBe('#9A9A9A');
  });
  it('converts hex to rgba', () => {
    expect(withAlpha('#E05A8A', 0.14)).toBe('rgba(224, 90, 138, 0.14)');
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });
  it('tints neutral with white at 7%, others with their colour at 14%', () => {
    expect(circleFill('neutral')).toBe('rgba(255, 255, 255, 0.07)');
    expect(circleFill('liked')).toBe('rgba(224, 90, 138, 0.14)');
  });
  it('sizes the rings from the circle', () => {
    const p = emptyMetrics('phone');
    expect([p.circle, p.icon, p.ringInner, p.ringOuter]).toEqual([88, 38, 116, 148]);
    const t = emptyMetrics('tv');
    expect([t.circle, t.icon]).toEqual([140, 60]);
    expect(t.ringOuter).toBeGreaterThan(t.ringInner);
  });
  it('fades ghost rows 100/70/40', () => {
    expect(GHOST_ROWS.map((r) => r.opacity)).toEqual([1, 0.7, 0.4]);
  });
});
