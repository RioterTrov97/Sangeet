/**
 * Reads the per-frame compressed sizes out of YouTube's fragmented AAC (itag 139/140/141) without decoding it. The
 * size of an AAC frame tracks how much is going on in the sound (a bass drop or a drum hit costs more bits than a
 * held note), so the sequence of sizes is a loudness/complexity envelope of the recording at one value per
 * 1024 samples (about 21-23 ms). Two encodes of the same recording share that envelope, shifted by the offset.
 * Pure byte parsing (no I/O) so it is unit-tested with hand-built boxes.
 */

const u32 = (d: Uint8Array, i: number) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
const type = (d: Uint8Array, i: number) => String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]);

type Box = { type: string; start: number; body: number; end: number };

/** Boxes at one level of `d[from..to)`; a truncated last box is reported with `end` clamped to `to`. */
export function boxes(d: Uint8Array, from = 0, to = d.length): Box[] {
  const out: Box[] = [];
  let i = from;
  while (i + 8 <= to) {
    let size = u32(d, i);
    let head = 8;
    if (size === 1 && i + 16 <= to) {
      size = u32(d, i + 8) * 2 ** 32 + u32(d, i + 12);
      head = 16;
    } else if (size === 0) size = to - i;
    if (size < head) break;
    out.push({ type: type(d, i + 4), start: i, body: i + head, end: Math.min(i + size, to) });
    if (i + size >= to) break;
    i += size;
  }
  return out;
}

const find = (d: Uint8Array, parent: Box | undefined, t: string): Box | undefined => (parent ? boxes(d, parent.body, parent.end) : boxes(d)).find((b) => b.type === t);

export type InitInfo = {
  /** Media timescale (= the sample rate for AAC). */
  timescale: number;
  /** Byte ranges (inclusive start, exclusive end) of each fragment in the file, from the sidx, and their durations in seconds. */
  fragments: { start: number; size: number; durationSec: number }[];
  /** Bytes of moov+sidx; the first fragment starts at `fragments[0].start`. */
  initEnd: number;
};

/** Timescale (moov/trak/mdia/mdhd) and the fragment table (sidx) from the head of the file. Undefined when not found in `d`. */
export function parseInit(d: Uint8Array): InitInfo | undefined {
  const top = boxes(d);
  const moov = top.find((b) => b.type === 'moov');
  const sidx = top.find((b) => b.type === 'sidx');
  if (!moov || !sidx || moov.end > d.length || sidx.end > d.length) return undefined;
  const mdhd = find(d, find(d, find(d, moov, 'trak'), 'mdia'), 'mdhd');
  if (!mdhd) return undefined;
  const mdhdTimescale = mdhd.body + 4 + (d[mdhd.body] === 1 ? 16 : 8);
  const timescale = u32(d, mdhdTimescale);
  // sidx: version/flags(4) reference_ID(4) timescale(4) earliest_presentation_time + first_offset (v0: 4+4, v1: 8+8) reserved(2) count(2)
  const v = d[sidx.body];
  let p = sidx.body + 4 + 4;
  const sidxScale = u32(d, p);
  p += 4;
  p += v === 0 ? 8 : 16;
  p += 2;
  const count = (d[p] << 8) | d[p + 1];
  p += 2;
  const firstOffset = v === 0 ? u32(d, sidx.body + 16) : u32(d, sidx.body + 24);
  let at = sidx.end + firstOffset;
  const fragments: InitInfo['fragments'] = [];
  for (let i = 0; i < count && p + 12 <= sidx.end; i++, p += 12) {
    const size = u32(d, p) & 0x7fffffff;
    fragments.push({ start: at, size, durationSec: u32(d, p + 4) / (sidxScale || 1) });
    at += size;
  }
  return { timescale, fragments, initEnd: sidx.end };
}

/** Sample sizes of the first track fragment found in a `moof` at the start of `d`; undefined when `d` does not hold the whole moof. */
export function parseMoofSizes(d: Uint8Array): number[] | undefined {
  const moof = boxes(d).find((b) => b.type === 'moof');
  if (!moof || moof.start + u32(d, moof.start) > d.length) return undefined;
  const traf = find(d, moof, 'traf');
  if (!traf) return undefined;
  const tfhd = find(d, traf, 'tfhd');
  const trun = find(d, traf, 'trun');
  if (!trun) return undefined;
  let defSize = 0;
  if (tfhd) {
    const flags = u32(d, tfhd.body) & 0xffffff;
    let p = tfhd.body + 8;
    if (flags & 0x1) p += 8;
    if (flags & 0x2) p += 4;
    if (flags & 0x8) p += 4;
    if (flags & 0x10) defSize = u32(d, p);
  }
  const flags = u32(d, trun.body) & 0xffffff;
  const n = u32(d, trun.body + 4);
  let p = trun.body + 8;
  if (flags & 0x1) p += 4;
  if (flags & 0x4) p += 4;
  const stride = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
  const sizeAt = (flags & 0x100 ? 4 : 0) + 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++, p += stride) {
    if (p + stride > trun.end) return undefined;
    out.push(flags & 0x200 ? u32(d, p + sizeAt) : defSize);
  }
  return out;
}

/** Declared size of the moof at the start of `d` (to know how much to fetch), or undefined when it is not a moof. */
export function moofSize(d: Uint8Array): number | undefined {
  return d.length >= 8 && type(d, 4) === 'moof' ? u32(d, 0) : undefined;
}
