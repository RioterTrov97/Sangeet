import { contrast } from './color';
import { TILE_PALETTE, tileColor } from './tiles';

describe('tileColor', () => {
  it('is deterministic per title', () => {
    expect(tileColor('Chill')).toBe(tileColor('Chill'));
  });
  it('keeps white text readable for pastel provider colours', () => {
    for (const c of ['#a7c5ff', '#ffe680', '#a8ffa8', '#cccccc', '#ffc107']) expect(contrast('#ffffff', tileColor('x', c))).toBeGreaterThanOrEqual(4.5);
  });
  it('every fallback palette colour passes too', () => {
    for (const [i, c] of TILE_PALETTE.entries()) expect(contrast('#ffffff', tileColor(`t${i}`, c))).toBeGreaterThanOrEqual(4.5);
  });
});
