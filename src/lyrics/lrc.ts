import type { LrcLine, LrcWord } from './types';

const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function toSec(m: string, s: string, f?: string): number {
  const frac = f ? Number(f.padEnd(3, '0').slice(0, 3)) / 1000 : 0;
  return Number(m) * 60 + Number(s) + frac;
}

export type ParsedLrc = { lines: LrcLine[]; offsetMs: number };

/**
 * Parses LRC text: multiple timestamps per line ("[00:10.00][00:50.00]chorus"), `[offset:+250]`
 * (ms; positive makes lyrics appear earlier, per the LRC spec), and enhanced word tags
 * `<00:10.50>word`. Metadata tags (`[ar:]`, `[ti:]`...) are ignored. Output is sorted by time.
 */
export function parseLrc(text: string): ParsedLrc {
  let offsetMs = 0;
  const lines: LrcLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) {
      offsetMs = Number(off[1]);
      continue;
    }
    TAG.lastIndex = 0;
    const times: number[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG.exec(raw)) && m.index === last) {
      times.push(toSec(m[1], m[2], m[3]));
      last = TAG.lastIndex;
    }
    if (!times.length) continue;
    const body = raw.slice(last);
    const { text: plain, words } = parseWords(body);
    for (const t of times) lines.push({ time: t, text: plain, ...(words ? { words } : {}) });
  }
  const shift = -offsetMs / 1000;
  const out = lines
    .sort((a, b) => a.time - b.time)
    .map((l) => (shift ? { ...l, time: Math.max(0, l.time + shift), words: l.words?.map((w) => ({ ...w, time: Math.max(0, w.time + shift) })) } : l));
  return { lines: out, offsetMs };
}

function parseWords(body: string): { text: string; words?: LrcWord[] } {
  WORD_TAG.lastIndex = 0;
  if (!WORD_TAG.test(body)) return { text: body.trim() };
  WORD_TAG.lastIndex = 0;
  const words: LrcWord[] = [];
  let m: RegExpExecArray | null;
  const marks: { time: number; start: number; end: number }[] = [];
  while ((m = WORD_TAG.exec(body))) marks.push({ time: toSec(m[1], m[2], m[3]), start: m.index, end: WORD_TAG.lastIndex });
  for (let i = 0; i < marks.length; i++) {
    const seg = body.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : undefined);
    if (seg.trim()) words.push({ time: marks[i].time, text: seg });
  }
  const text = body.replace(WORD_TAG, '').replace(/\s{2,}/g, ' ').trim();
  return { text, words: words.length ? words : undefined };
}

/** Index of the active line at `pos` seconds (last line whose time <= pos), or -1 before the first. */
export function activeLineIndex(lines: LrcLine[], pos: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** True when the lines carry no real timing (all zero / all identical), i.e. effectively plain text. */
export const isTimed = (lines: LrcLine[]) => lines.length > 1 && new Set(lines.map((l) => l.time)).size > 1;
