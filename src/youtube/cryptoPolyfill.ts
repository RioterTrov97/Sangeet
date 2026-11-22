/**
 * Hermes has no Web Crypto. youtubei.js (react-native platform) needs `crypto.subtle.digest('SHA-1')` to sign every
 * signed-in request (SAPISIDHASH) and `crypto.randomUUID()`; without them every authed call throws
 * "Property 'crypto' doesn't exist". This fills in only what is missing (never replaces a real implementation).
 * Neither use is security-sensitive: the hash is a request signature format, the UUIDs are request ids.
 */

/** SHA-1 of bytes, pure JS. */
export function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length;
  const withPad = ((ml + 8) >> 6) * 64 + 64;
  const msg = new Uint8Array(withPad);
  msg.set(bytes);
  msg[ml] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(withPad - 8, Math.floor((ml * 8) / 0x100000000));
  dv.setUint32(withPad - 4, (ml * 8) >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
  return out;
}

function randomUUID(): string {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (ch) => {
    const c = Number(ch);
    return (c ^ (Math.floor(Math.random() * 16) & (15 >> (c / 4)))).toString(16);
  });
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Installs the missing pieces on `target` (globalThis by default). */
export function installCryptoPolyfill(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  const c = (target.crypto ?? (target.crypto = {})) as Record<string, unknown>;
  if (typeof c.randomUUID !== 'function') c.randomUUID = randomUUID;
  const subtle = (c.subtle ?? (c.subtle = {})) as Record<string, unknown>;
  if (typeof subtle.digest !== 'function') {
    subtle.digest = async (alg: string | { name: string }, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> => {
      const name = (typeof alg === 'string' ? alg : alg.name).toUpperCase();
      if (name !== 'SHA-1') throw new Error(`digest ${name} not available`);
      const h = sha1(toBytes(data));
      return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength) as ArrayBuffer;
    };
  }
}

installCryptoPolyfill();
