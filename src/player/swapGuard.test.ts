import { activeSwap, beginSwap, blocksAdvance, endSwap, isSpuriousChange, needsRestore, restorePosition, SWAP_HOLD_MS } from './swapGuard';

describe('swap guard', () => {
  afterEach(endSwap);

  it('blocks queue advances only while a swap is active', () => {
    expect(blocksAdvance(1000)).toBe(false);
    beginSwap('a', 2, 40, 1000);
    expect(blocksAdvance(1000 + SWAP_HOLD_MS - 1)).toBe(true);
    expect(blocksAdvance(1000 + SWAP_HOLD_MS)).toBe(false);
    expect(activeSwap(500)?.id).toBe('a');
  });

  it('treats a native change to another track as spurious, and the same track as fine', () => {
    beginSwap('a', 2, 40, 1000);
    expect(isSpuriousChange('b', 2000)).toBe(true);
    expect(isSpuriousChange('a', 2000)).toBe(false);
    expect(isSpuriousChange('b', 1000 + SWAP_HOLD_MS + 1)).toBe(false);
  });

  it('ends cleanly', () => {
    beginSwap('a', 0, 0, 0);
    endSwap();
    expect(blocksAdvance(1)).toBe(false);
  });

  it('detects a queue that left the swapped track', () => {
    const s = beginSwap('a', 2, 40, 1000);
    expect(needsRestore(s, { id: 'a', index: 2 })).toBe(false);
    expect(needsRestore(s, { id: 'b', index: 3 })).toBe(true);
    expect(needsRestore(s, { id: undefined, index: 2 })).toBe(true);
  });

  it('restores to the swap position, advancing with elapsed time only while playing', () => {
    const s = beginSwap('a', 2, 40, 1000);
    expect(restorePosition(s, 3500, true)).toBeCloseTo(42.5, 3);
    expect(restorePosition(s, 3500, false)).toBe(40);
  });
});
