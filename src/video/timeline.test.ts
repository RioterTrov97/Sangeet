import type { LrcLine } from '../lyrics/types';
import { alignEnvelopes, audioAccepted, enterPosition, estimateFromLines, exitPosition, lyricsStretchFor, matchLines, median, offsetFromLengths, sameCues, stretchLines } from './timeline';

const L = (time: number, text: string): LrcLine => ({ time, text });

describe('lyricsStretchFor', () => {
  it('no stretch when the offset is known', () => expect(lyricsStretchFor(true, 200, 400)).toBeUndefined());
  it('no stretch (sync control only) when the lengths are close', () => expect(lyricsStretchFor(false, 200, 215)).toBeUndefined());
  it('stretches over a clearly different cut', () => expect(lyricsStretchFor(false, 200, 260)).toBeCloseTo(1.3));
  it('never stretches on unknown lengths', () => expect(lyricsStretchFor(false, undefined, 260)).toBeUndefined());
  it('scales line and word times', () => {
    const [l] = stretchLines([{ time: 10, text: 'a', words: [{ time: 10, text: 'a', dur: 1 }] }], 1.5);
    expect(l.time).toBe(15);
    expect(l.words?.[0]).toEqual({ time: 15, text: 'a', dur: 1.5 });
  });
});

describe('position mapping', () => {
  test('enter adds the offset, exit removes it', () => {
    expect(enterPosition(60, 12)).toBe(72);
    expect(exitPosition(72, 12)).toBe(60);
    expect(enterPosition(60, -4)).toBe(56);
  });
  test('video-only intro and outro clamp to the nearest valid point', () => {
    expect(exitPosition(5, 12, 200)).toBe(0); // inside the 12 s video-only intro
    expect(enterPosition(3, -10)).toBe(0); // the video starts 10 s into the song
    expect(exitPosition(400, 12, 200)).toBe(199.5); // video outro
    expect(enterPosition(199, 12, 205)).toBe(204.5);
  });
  test('garbage in gives 0', () => {
    expect(enterPosition(NaN, 3)).toBe(0);
    expect(exitPosition(NaN, 3)).toBe(0);
  });
});

describe('offsetFromLengths', () => {
  test('within 2 s is the same edit', () => {
    expect(offsetFromLengths(200, 201.5)).toBe(0);
    expect(offsetFromLengths(200, 198.1)).toBe(0);
  });
  test('further apart, or unknown, says nothing', () => {
    expect(offsetFromLengths(200, 203)).toBeUndefined();
    expect(offsetFromLengths(undefined, 200)).toBeUndefined();
    expect(offsetFromLengths(200, 0)).toBeUndefined();
  });
});

describe('median', () => {
  test('odd, even, empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
  test('an outlier does not move it', () => {
    expect(median([12.1, 12.0, 11.9, 12.05, 80])).toBe(12.05);
  });
});

const song = [L(10, 'Hello darkness my old friend'), L(15, 'I have come to talk with you again'), L(20, 'Because a vision softly creeping'), L(25, 'Left its seeds while I was sleeping'), L(30, 'And the vision that was planted'), L(35, 'Hello darkness my old friend'), L(40, 'ah')];

describe('line matching', () => {
  test('pairs lines in order and ignores case and punctuation', () => {
    const video = song.map((l) => L(l.time + 12, l.text.toUpperCase() + '!'));
    const ms = matchLines(song, video);
    expect(ms).toHaveLength(6); // "ah" is too short to anchor
    expect(ms.every((m) => Math.abs(m.delta - 12) < 1e-9)).toBe(true);
  });
  test('a repeated line pairs with its own repeat, not the first one', () => {
    const video = [L(30, 'Hello darkness my old friend'), L(55, 'Hello darkness my old friend')];
    const ms = matchLines([L(10, 'Hello darkness my old friend'), L(35, 'Hello darkness my old friend')], video);
    expect(ms.map((m) => m.delta)).toEqual([20, 20]);
  });
  test('estimate: median delta with a few wrong matches', () => {
    const video = song.map((l) => L(l.time + 8.5, l.text));
    video[2] = L(99, song[2].text); // a mis-timed line
    const e = estimateFromLines(song, video)!;
    expect(e.offset).toBeCloseTo(8.5, 2);
    expect(e.agree).toBeGreaterThanOrEqual(5);
  });
  test('negative offset (video cuts the song intro)', () => {
    const video = song.map((l) => L(l.time - 6, l.text));
    expect(estimateFromLines(song, video)!.offset).toBeCloseTo(-6, 2);
  });
  test('too few matches or no agreement is not trusted', () => {
    expect(estimateFromLines(song, [L(1, 'Hello darkness my old friend'), L(2, 'something else entirely')])).toBeUndefined();
    const scattered = song.map((l, i) => L(l.time + i * 7, l.text));
    expect(estimateFromLines(song, scattered)).toBeUndefined();
  });
  test('identical cue lists are recognised as the same record', () => {
    expect(sameCues(song, song.map((l) => ({ ...l })))).toBe(true);
    expect(sameCues(song, song.slice(1))).toBe(false);
    expect(sameCues(song, song.map((l) => L(l.time + 1, l.text)))).toBe(false);
  });
});

// A deterministic pseudo-random "loudness envelope": bursts of different heights, so it has plenty of structure.
function envelope(n: number, seed: number): number[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: number[] = [];
  let level = 0;
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.06) level = rnd() * 10;
    level *= 0.9;
    out.push(level + rnd());
  }
  return out;
}

describe('envelope alignment', () => {
  const hop = 0.0232; // one AAC frame at 44.1 kHz
  const frames = (sec: number) => Math.round(sec / hop);
  const song = envelope(frames(125), 7);
  const noise = envelope(frames(300), 99).map((x) => x * 0.3);
  const reencode = (x: number[], at: number) => x.map((v, i) => v * 0.8 + noise[i + at] * 0.2);

  test('finds a video intro (video later than the song)', async () => {
    const video = [...envelope(frames(14), 3), ...reencode(song, 0), ...envelope(frames(60), 5)];
    const a = (await alignEnvelopes(song, video, hop))!;
    expect(a.lagSec).toBeCloseTo(14, 1);
    expect(audioAccepted(a)).toBe(true);
  });
  test('finds a negative lag (video starts later in the song)', async () => {
    const video = reencode(song.slice(frames(9)), 5).concat(envelope(frames(60), 8));
    const a = (await alignEnvelopes(song, video, hop))!;
    expect(a.lagSec).toBeCloseTo(-9, 1);
    expect(audioAccepted(a)).toBe(true);
  });
  test('zero lag for the same audio', async () => {
    const a = (await alignEnvelopes(song, song, hop))!;
    expect(a.lagSec).toBeCloseTo(0, 1);
    expect(a.score).toBeGreaterThan(0.95);
  });
  test('unrelated audio is not accepted', async () => {
    expect(audioAccepted(await alignEnvelopes(song, envelope(frames(220), 12345), hop))).toBe(false);
  });
  test('a loop that repeats every 6.5 s is ambiguous, so it is not accepted', async () => {
    const bar = envelope(frames(6.5), 21);
    const loop = (n: number, phase = 0) => Array.from({ length: n }, (_, i) => bar[(i + phase) % bar.length] + noise[i] * 0.05);
    expect(audioAccepted(await alignEnvelopes(loop(frames(125)), loop(frames(220), frames(3.5)), hop))).toBe(false);
  });
  test('too little overlap gives nothing', async () => {
    expect(await alignEnvelopes(song.slice(0, 100), song.slice(0, 100), hop)).toBeUndefined();
  });
});
