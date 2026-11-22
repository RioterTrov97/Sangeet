import { log } from '../util/log';
import { moofSize, parseInit, parseMoofSizes } from './mp4Envelope';

export type Envelope = {
  /** One value per AAC frame: its compressed size in bytes. */
  sizes: number[];
  hopSec: number;
  /** Cost: bytes fetched, requests made, wall time. */
  bytes: number;
  requests: number;
  ms: number;
};

type Get = (url: string, range: string) => Promise<Uint8Array>;

const defaultGet: Get = async (url, range) => {
  const res = await fetch(url, { headers: { Range: `bytes=${range}` } });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

/**
 * Frame-size envelope of the first `seconds` of an audio stream served as fragmented AAC (the stream proxy's `/v/<id>`).
 * `moof` mode reads only the small fragment headers (init + sidx, then ~5 s fragment index per request, 4 at a time: a
 * few kB per 5 s); `bulk` mode reads the media itself in one range request (about 16 kB per second at 128 kbps).
 */
export async function fetchEnvelope(url: string, seconds: number, mode: 'moof' | 'bulk' = 'moof', get: Get = defaultGet): Promise<Envelope> {
  const t0 = Date.now();
  let bytes = 0;
  let requests = 0;
  const grab: Get = async (u, r) => {
    const b = await get(u, r);
    bytes += b.length;
    requests++;
    return b;
  };
  let head = await grab(url, '0-4095');
  let info = parseInit(head);
  if (!info) {
    head = await grab(url, '0-65535');
    info = parseInit(head);
  }
  if (!info || !info.fragments.length) throw new Error('not a fragmented mp4 audio stream');
  const hopSec = 1024 / info.timescale;
  const want: typeof info.fragments = [];
  let have = 0;
  for (const f of info.fragments) {
    if (have >= seconds) break;
    want.push(f);
    have += f.durationSec;
  }
  const sizes: number[] = [];
  if (mode === 'bulk') {
    const last = want[want.length - 1];
    const buf = await grab(url, `${want[0].start}-${last.start + last.size - 1}`);
    for (const f of want) {
      const slice = buf.subarray(f.start - want[0].start, f.start - want[0].start + f.size);
      const sz = parseMoofSizes(slice);
      if (!sz) throw new Error('moof parse failed');
      sizes.push(...sz);
    }
  } else {
    const parts: (number[] | undefined)[] = new Array(want.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < want.length; i = next++) {
        const f = want[i];
        let b = await grab(url, `${f.start}-${f.start + 4095}`);
        let sz = parseMoofSizes(b);
        if (!sz) {
          const need = moofSize(b);
          if (!need) throw new Error('fragment is not a moof');
          b = await grab(url, `${f.start}-${f.start + need - 1}`);
          sz = parseMoofSizes(b);
        }
        parts[i] = sz;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    for (const p of parts) {
      if (!p) throw new Error('moof parse failed');
      sizes.push(...p);
    }
  }
  const ms = Date.now() - t0;
  log('offset', `envelope ${url.slice(url.indexOf('/v/'))} ${mode}: ${sizes.length} frames (${(sizes.length * hopSec).toFixed(0)} s), ${bytes} B in ${requests} requests, ${ms} ms`);
  return { sizes, hopSec, bytes, requests, ms };
}
