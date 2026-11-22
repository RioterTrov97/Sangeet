import { installCryptoPolyfill, sha1 } from './cryptoPolyfill';

const hex = (b: Uint8Array | ArrayBuffer) => Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString('hex');
const enc = (s: string) => new TextEncoder().encode(s);

describe('sha1', () => {
  it('matches the standard test vectors', () => {
    expect(hex(sha1(enc('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(enc('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
  });

  it('handles lengths around the 55/56/64 byte padding edges', () => {
    const { createHash } = jest.requireActual<typeof import('crypto')>('crypto');
    for (const n of [55, 56, 63, 64, 65, 119, 120, 1000]) {
      const s = 'x'.repeat(n);
      expect(hex(sha1(enc(s)))).toBe(createHash('sha1').update(s).digest('hex'));
    }
  });
});

describe('installCryptoPolyfill', () => {
  it('fills an empty global with digest and randomUUID', async () => {
    const g: Record<string, any> = {};
    installCryptoPolyfill(g);
    expect(hex(await g.crypto.subtle.digest('SHA-1', enc('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(g.crypto.randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await expect(g.crypto.subtle.digest('SHA-256', enc('abc'))).rejects.toThrow();
  });

  it('never replaces an existing implementation', () => {
    const digest = jest.fn();
    const randomUUID = jest.fn();
    const g: Record<string, any> = { crypto: { randomUUID, subtle: { digest } } };
    installCryptoPolyfill(g);
    expect(g.crypto.subtle.digest).toBe(digest);
    expect(g.crypto.randomUUID).toBe(randomUUID);
  });
});
