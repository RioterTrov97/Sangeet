import type { LrcLine, LrcWord } from './types';

/**
 * Minimal TTML reader for the lyric files lrc.red serves (Apple-style): `<p begin end>` is a line, `<span begin end>` inside it a word
 * (when the file is word-timed). Background-vocal / translation / romanisation spans are skipped. No DOM in React Native, so this is a
 * small tag scanner, not an XML parser. Pure; output is sorted by time.
 */

/** "00:00:34.170", "4:28.165", "9.615" or "9.615s" to seconds, NaN when unreadable. */
export function parseClock(v: string | undefined): number {
  if (!v) return NaN;
  const s = v.trim().replace(/s$/, '');
  if (!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(s)) return NaN;
  return s.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = m[2] ?? m[3];
  return out;
}

export type TtmlResult = { lines: LrcLine[]; timing: 'word' | 'line'; lang?: string; durationSec?: number };

const SKIP_ROLES = /x-bg|x-translation|x-roman/i;
const TAG = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g;

export function parseTtml(xml: string): TtmlResult {
  const root = attrs(/<tt\b[^>]*>/.exec(xml)?.[0] ?? '');
  const lines: LrcLine[] = [];
  let pStart = NaN;
  let inP = false;
  let text = '';
  let words: LrcWord[] = [];
  let skipDepth = 0; // > 0 while inside a skipped span
  let spanDepth = 0;
  let span: { begin: number; end: number; text: string } | undefined;
  let m: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(xml))) {
    const [, close, name, rest, selfClose, chars] = m;
    if (chars !== undefined) {
      if (!inP || skipDepth) continue;
      const t = decodeEntities(chars);
      if (span) span.text += t;
      text += t;
      continue;
    }
    const tag = name.toLowerCase().replace(/^.*:/, '');
    if (!inP) {
      if (tag === 'p' && !close && !selfClose) {
        const a = attrs(rest);
        pStart = parseClock(a.begin);
        inP = true;
        text = '';
        words = [];
        span = undefined;
        spanDepth = 0;
        skipDepth = 0;
      }
      continue;
    }
    if (tag === 'br') {
      if (!skipDepth) text += ' ';
    } else if (tag === 'span') {
      if (close) {
        if (skipDepth) skipDepth--;
        else {
          spanDepth--;
          if (spanDepth === 0 && span) {
            const w = span.text.trim();
            if (w && Number.isFinite(span.begin)) words.push({ time: span.begin, text: w, ...(Number.isFinite(span.end) && span.end > span.begin ? { dur: span.end - span.begin } : {}) });
            span = undefined;
          }
        }
      } else if (!selfClose) {
        const a = attrs(rest);
        if (skipDepth || SKIP_ROLES.test(a['ttm:role'] ?? a.role ?? '')) skipDepth++;
        else {
          if (spanDepth === 0) span = { begin: parseClock(a.begin), end: parseClock(a.end), text: '' };
          spanDepth++;
        }
      }
    } else if (tag === 'p' && close) {
      const line = text.replace(/\s+/g, ' ').trim();
      if (line && Number.isFinite(pStart)) lines.push({ time: pStart, text: line, ...(words.length ? { words } : {}) });
      inP = false;
    }
  }
  lines.sort((a, b) => a.time - b.time);
  const timing = root['lrc:timing']?.toLowerCase() === 'word' || lines.some((l) => l.words?.length) ? 'word' : 'line';
  const bodyDur = parseClock(/<body\b[^>]*\bdur="([^"]*)"/.exec(xml)?.[1]);
  return { lines, timing, lang: root['xml:lang'], durationSec: Number.isFinite(bodyDur) ? bodyDur : undefined };
}
