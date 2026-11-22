import { readFileSync } from 'fs';
import { join } from 'path';
import { decodeEntities, parseClock, parseTtml } from './ttml';

const fx = (n: string) => readFileSync(join(__dirname, '__fixtures__', n), 'utf8');

describe('parseClock', () => {
  it('reads the clock shapes lrc.red uses', () => {
    expect(parseClock('00:00:34.170')).toBeCloseTo(34.17);
    expect(parseClock('4:28.165')).toBeCloseTo(268.165);
    expect(parseClock('9.615')).toBeCloseTo(9.615);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('soon')).toBeNaN();
    expect(parseClock(undefined)).toBeNaN();
  });
});
describe('decodeEntities', () => {
  it('decodes named and numeric', () => expect(decodeEntities('a &amp; b &#39;c&#x27; &lt;')).toBe("a & b 'c' <"));
});
describe('parseTtml', () => {
  it('parses a line-timed Nepali file (Devanagari)', () => {
    const r = parseTtml(fx('naganya-line.ttml'));
    expect(r.timing).toBe('line');
    expect(r.lines.length).toBeGreaterThan(10);
    expect(r.lines[0].time).toBeCloseTo(34.17);
    expect(r.lines[0].text).toMatch(/[ऀ-ॿ]/);
    expect(r.lines[0].words).toBeUndefined();
    expect(r.durationSec).toBeCloseTo(289.2);
    expect(r.lines.map((l) => l.time)).toEqual([...r.lines.map((l) => l.time)].sort((a, b) => a - b));
  });
  it('parses a word-timed file with word starts and durations', () => {
    const r = parseTtml(fx('kes.ttml'));
    expect(r.timing).toBe('word');
    expect(r.lang).toBe('hi');
    expect(r.lines[0].text).toBe('Mujhko itna bataye koyi');
    expect(r.lines[0].time).toBeCloseTo(9.615);
    expect(r.lines[0].words?.map((w) => w.text)).toEqual(['Mujhko', 'itna', 'bataye', 'koyi']);
    expect(r.lines[0].words?.[0].dur).toBeCloseTo(3.504);
    expect(r.durationSec).toBeCloseTo(268.165);
  });
  it('skips background, translation and romanisation spans and decodes entities', () => {
    const xml = `<tt xmlns:ttm="x" xmlns:lrc="y" lrc:timing="Word"><body><div><p begin="1.0" end="3.0"><span begin="1.0" end="2.0">Tom &amp;</span> <span begin="2.0" end="3.0">Jerry<span ttm:role="x-translation">XX</span></span><span ttm:role="x-bg"><span begin="2" end="3">(oh)</span></span></p><p begin="4" end="5">plain<br/>line</p></div></body></tt>`;
    const r = parseTtml(xml);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].text).toBe('Tom & Jerry');
    expect(r.lines[0].words?.map((w) => w.text)).toEqual(['Tom &', 'Jerry']);
    expect(r.lines[1].text).toBe('plain line');
  });
  it('returns nothing for junk', () => expect(parseTtml('not xml').lines).toEqual([]));
});
