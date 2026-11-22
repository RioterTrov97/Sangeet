import { clearSeekHold, holdDrops, seekHoldDrops, startSeekHold } from './seekHold';

describe('seek hold', () => {
  const h = { target: 120, at: 1000 };
  it('does not drop without a hold', () => expect(holdDrops(null, 5, 1000)).toBe(false));
  it('drops pre-seek positions', () => expect(holdDrops(h, 30, 1200)).toBe(true));
  it('accepts a position near the target', () => {
    expect(holdDrops(h, 120.4, 1200)).toBe(false);
    expect(holdDrops(h, 119.2, 1200)).toBe(false);
  });
  it('gives up after 1.5 s', () => expect(holdDrops(h, 30, 2600)).toBe(false));
  it('module state releases after the first near report', () => {
    startSeekHold(60, 0);
    expect(seekHoldDrops(10, 100)).toBe(true);
    expect(seekHoldDrops(60.2, 200)).toBe(false);
    expect(seekHoldDrops(10, 300)).toBe(false);
    clearSeekHold();
  });
});
