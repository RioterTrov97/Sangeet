import { boxes, moofSize, parseInit, parseMoofSizes } from './mp4Envelope';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (t: string, ...parts: (number[] | Uint8Array)[]): number[] => {
  const body = parts.flatMap((p) => Array.from(p));
  return [...be32(8 + body.length), ...Array.from(t).map((c) => c.charCodeAt(0)), ...body];
};

function init(timescale: number, frags: { size: number; dur: number }[]): Uint8Array {
  const mdhd = box('mdhd', [0, 0, 0, 0], be32(0), be32(0), be32(timescale), be32(0), [0, 0, 0, 0]);
  const moov = box('moov', box('trak', box('mdia', mdhd)));
  const refs = frags.flatMap((f) => [...be32(f.size), ...be32(f.dur), ...be32(0x90000000)]);
  const sidx = box('sidx', [0, 0, 0, 0], be32(1), be32(timescale), be32(0), be32(0), [0, 0], [0, frags.length], refs);
  return Uint8Array.from([...box('ftyp', [1, 2, 3, 4]), ...moov, ...sidx]);
}

function moof(sizes: number[], opts: { defSize?: number } = {}): Uint8Array {
  const tfhd = box('tfhd', [0, 0, 0, opts.defSize ? 0x10 : 0], be32(1), opts.defSize ? be32(opts.defSize) : []);
  const flags = opts.defSize ? 0 : 0x200; // sample sizes present
  const trun = box('trun', [0, 0, flags >> 8, flags & 255], be32(sizes.length), ...(opts.defSize ? [] : sizes.map((s) => be32(s))));
  return Uint8Array.from(box('moof', box('mfhd', [0, 0, 0, 0], be32(1)), box('traf', tfhd, trun)));
}

test('boxes lists one level', () => {
  const d = Uint8Array.from([...box('free', [1]), ...box('moov', [])]);
  expect(boxes(d).map((b) => b.type)).toEqual(['free', 'moov']);
});

test('parseInit reads the timescale and the fragment table', () => {
  const d = init(44100, [{ size: 1000, dur: 220500 }, { size: 900, dur: 220500 }]);
  const i = parseInit(d)!;
  expect(i.timescale).toBe(44100);
  expect(i.fragments).toHaveLength(2);
  expect(i.fragments[0].start).toBe(d.length);
  expect(i.fragments[1].start).toBe(d.length + 1000);
  expect(i.fragments[0].durationSec).toBeCloseTo(5, 6);
});

test('parseInit is undefined when the head is cut short', () => {
  expect(parseInit(init(48000, [{ size: 10, dur: 48000 }]).slice(0, 40))).toBeUndefined();
});

test('parseMoofSizes returns the per-sample sizes', () => {
  expect(parseMoofSizes(moof([300, 410, 288]))).toEqual([300, 410, 288]);
  expect(moofSize(moof([1, 2]))).toBe(moof([1, 2]).length);
});

test('default sample size from the tfhd', () => {
  expect(parseMoofSizes(moof([0, 0, 0], { defSize: 256 }))).toEqual([256, 256, 256]);
});

test('a moof that is not fully in the buffer is undefined', () => {
  const m = moof([1, 2, 3, 4]);
  expect(parseMoofSizes(m.slice(0, m.length - 3))).toBeUndefined();
});
