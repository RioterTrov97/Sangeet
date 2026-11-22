import { activeLineIndex, parseLrc } from './lrc';

describe('parseLrc', () => {
  it('parses lines and ignores metadata', () => {
    const { lines } = parseLrc('[ar:Artist]\n[ti:Song]\n[00:12.34]Hello\n[00:15.5]World');
    expect(lines).toEqual([
      { time: 12.34, text: 'Hello' },
      { time: 15.5, text: 'World' },
    ]);
  });
  it('expands multiple timestamps per line and sorts', () => {
    const { lines } = parseLrc('[00:50.00][00:10.00]Chorus\n[00:30.00]Verse');
    expect(lines.map((l) => [l.time, l.text])).toEqual([[10, 'Chorus'], [30, 'Verse'], [50, 'Chorus']]);
  });
  it('applies [offset:] (positive = earlier) in ms', () => {
    const { lines, offsetMs } = parseLrc('[offset:+500]\n[00:10.00]A');
    expect(offsetMs).toBe(500);
    expect(lines[0].time).toBeCloseTo(9.5);
  });
  it('parses enhanced word tags', () => {
    const { lines } = parseLrc('[00:10.00]<00:10.00>Hel<00:10.40>lo <00:11.00>world');
    expect(lines[0].text).toBe('Hello world');
    expect(lines[0].words).toEqual([
      { time: 10, text: 'Hel' },
      { time: 10.4, text: 'lo ' },
      { time: 11, text: 'world' },
    ]);
  });
  it('keeps empty lines as instrumental gaps and handles CRLF and 3-digit fractions', () => {
    const { lines } = parseLrc('[00:01.123]\r\n[00:02.000]x');
    expect(lines[0]).toEqual({ time: 1.123, text: '' });
    expect(lines).toHaveLength(2);
  });
  it('finds the active line', () => {
    const { lines } = parseLrc('[00:10.00]a\n[00:20.00]b\n[00:30.00]c');
    expect(activeLineIndex(lines, 5)).toBe(-1);
    expect(activeLineIndex(lines, 10)).toBe(0);
    expect(activeLineIndex(lines, 25)).toBe(1);
    expect(activeLineIndex(lines, 99)).toBe(2);
  });
});
