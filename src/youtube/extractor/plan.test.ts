import { anyNeedsPot, formatNeedsPlayer, lazyByKey, lazyOnce, needsGvsPot, needsPlayer } from './plan';

describe('which clients need what', () => {
  it('VISIONOS needs neither a PO token nor the player', () => {
    expect(needsGvsPot('VISIONOS')).toBe(false);
    expect(needsPlayer('VISIONOS')).toBe(false);
  });
  it('TV needs the player but no token', () => {
    expect(needsGvsPot('TV')).toBe(false);
    expect(needsPlayer('TV')).toBe(true);
  });
  it('MWEB and WEB_EMBEDDED need both', () => {
    for (const c of ['MWEB', 'WEB_EMBEDDED']) {
      expect(needsGvsPot(c)).toBe(true);
      expect(needsPlayer(c)).toBe(true);
    }
  });
  it('a ciphered format needs the player even for VISIONOS', () => {
    expect(formatNeedsPlayer('VISIONOS', {})).toBe(false);
    expect(formatNeedsPlayer('VISIONOS', { signature_cipher: 's=abc' })).toBe(true);
  });
  it('anyNeedsPot', () => {
    expect(anyNeedsPot(['VISIONOS', 'TV'])).toBe(false);
    expect(anyNeedsPot(['VISIONOS', 'MWEB'])).toBe(true);
  });
});

describe('lazyOnce', () => {
  it('runs once and shares the promise', async () => {
    const fn = jest.fn(async () => 7);
    const l = lazyOnce(fn);
    expect(l.started()).toBe(false);
    expect(await Promise.all([l.get(), l.get()])).toEqual([7, 7]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(l.started()).toBe(true);
  });
  it('resets on failure so the next call retries', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(1);
    const l = lazyOnce(fn);
    await expect(l.get()).rejects.toThrow('x');
    expect(l.started()).toBe(false);
    expect(await l.get()).toBe(1);
  });
});

describe('lazyByKey', () => {
  it('memoises per key and drops failures', async () => {
    const fn = jest.fn(async (k: string) => `t:${k}`);
    const g = lazyByKey(fn);
    await g('a');
    await g('a');
    await g('b');
    expect(fn).toHaveBeenCalledTimes(2);
    const bad = jest.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValue('ok');
    const g2 = lazyByKey(bad);
    await expect(g2('a')).rejects.toThrow();
    expect(await g2('a')).toBe('ok');
  });
});
