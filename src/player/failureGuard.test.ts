import { FailureGuard, MAX_CONSECUTIVE_FAILURES } from './failureGuard';

describe('FailureGuard', () => {
  it('lets two failures skip and halts on the third', () => {
    const g = new FailureGuard();
    expect(g.failed()).toEqual({ halt: false, count: 1 });
    expect(g.failed()).toEqual({ halt: false, count: 2 });
    expect(g.failed()).toEqual({ halt: true, count: MAX_CONSECUTIVE_FAILURES });
  });
  it('resets on success so isolated failures never halt', () => {
    const g = new FailureGuard();
    for (let i = 0; i < 10; i++) {
      expect(g.failed().halt).toBe(false);
      g.reset();
    }
  });
  it('gives a retry a fresh budget after a halt', () => {
    const g = new FailureGuard();
    g.failed();
    g.failed();
    expect(g.failed().halt).toBe(true);
    expect(g.failed().halt).toBe(false);
  });
});
