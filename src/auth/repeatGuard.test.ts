import { REPEAT_MS, repeatGuard } from './repeatGuard';

describe('repeatGuard', () => {
  it('drops the same id right after, but not later or a different id', () => {
    const seen = repeatGuard();
    expect(seen('a', 0)).toBe(false);
    expect(seen('a', 500)).toBe(true);
    expect(seen('b', 600)).toBe(false);
    expect(seen('a', 700)).toBe(false);
    expect(seen('a', 700 + REPEAT_MS)).toBe(false);
  });
});
