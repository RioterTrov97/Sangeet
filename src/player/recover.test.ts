import { endedEarly, MAX_RECOVER_ATTEMPTS, RecoverGuard, START_RETRY_MS, StartRetry } from './recover';

describe('RecoverGuard', () => {
  it('plans up to 3 resumes at the same position with growing backoff, then gives up', () => {
    const g = new RecoverGuard();
    const a = g.next('t', 64.2);
    const b = g.next('t', 64.2);
    const c = g.next('t', 64.2);
    expect([a?.attempt, b?.attempt, c?.attempt]).toEqual([1, 2, 3]);
    expect(a?.positionSec).toBe(64.2);
    expect(a!.delayMs).toBeLessThan(b!.delayMs);
    expect(b!.delayMs).toBeLessThan(c!.delayMs);
    expect(g.next('t', 64.2)).toBeNull();
    expect(MAX_RECOVER_ATTEMPTS).toBe(3);
  });
  it('does not recover a track that never started', () => {
    const g = new RecoverGuard();
    expect(g.next('t', 0)).toBeNull();
    expect(g.next('t', NaN)).toBeNull();
  });
  it('gives each track, and a track that played on for a while, a fresh budget', () => {
    const g = new RecoverGuard();
    g.next('a', 30);
    g.next('a', 30);
    g.next('a', 30);
    expect(g.next('a', 31)).toBeNull();
    expect(g.next('b', 30)?.attempt).toBe(1);
    g.next('b', 30);
    g.next('b', 30);
    expect(g.next('b', 60)?.attempt).toBe(1);
  });
});

describe('StartRetry', () => {
  it('retries the same song twice, then gives up; another song gets its own budget', () => {
    const r = new StartRetry();
    expect(r.next('a')).toBe(START_RETRY_MS[0]);
    expect(r.next('a')).toBe(START_RETRY_MS[1]);
    expect(r.next('a')).toBeNull();
    expect(r.next('b')).toBe(START_RETRY_MS[0]);
    r.reset();
    expect(r.next('b')).toBe(START_RETRY_MS[0]);
  });
});

describe('endedEarly', () => {
  it('is true well before the end of a known length', () => {
    expect(endedEarly(0, 200)).toBe(true);
    expect(endedEarly(120, 200)).toBe(true);
  });
  it('is false near the end, and for unknown or very short lengths', () => {
    expect(endedEarly(190, 200)).toBe(false);
    expect(endedEarly(0, 0)).toBe(false);
    expect(endedEarly(0, 25)).toBe(false);
  });
});
