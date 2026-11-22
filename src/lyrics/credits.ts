/**
 * Credit lines that some sources put at the start or end of the lyrics ("Lyrics by ...", "Music: ...", "作词 : ..."). Only the lines at
 * the very start and the very end are removed (a contiguous run each), never anything in the middle. Behaviour as in Metrolist, reimplemented.
 */
const CREDIT =
  /^\s*(?:lyrics?\s*(?:by|writer|:|-)|lyricists?\b|written\s+by|writers?\s*:|songwriters?\s*:|composed\s+by|composers?\s*:|composition\s*:|music\s*(?:by\s|composed\s+by\s|:|：)|singers?\s*(?:name\s*)?:|vocals?\s*(?:by\s|:)|produced\s+by|arranged\s+by|arrangement\s*:|作词|作曲|编曲|歌手|词\s*[:：]|曲\s*[:：]|作詞|編曲|(?:制作人?|製作人?|监制|混音|混缩|母带|和声|和聲|吉他|贝斯|貝斯|鼓|钢琴|鋼琴|弦乐|录音|錄音|配唱|出品|发行|策划|演唱|原唱|OP|SP|ISRC)\s*[:：])/i;
const MAX_EDGE = 8;
const MAX_LINE = 100;

export const isCreditLine = (text: string): boolean => text.length <= MAX_LINE && CREDIT.test(text);

/** How many leading / trailing entries are credits (blank ones between them are skipped and removed along with them). */
function edges(texts: readonly string[]): { head: number; tail: number } {
  let head = 0;
  let seen = 0;
  for (let i = 0; i < texts.length && seen < MAX_EDGE; i++) {
    if (!texts[i].trim()) {
      if (seen > 0 || i === head) head = i + 1; // blanks directly before / between credits go too
      continue;
    }
    if (!isCreditLine(texts[i])) break;
    seen++;
    head = i + 1;
  }
  if (seen === 0) head = 0;
  let tail = 0;
  let seenT = 0;
  for (let i = texts.length - 1; i >= head && seenT < MAX_EDGE; i--) {
    if (!texts[i].trim()) {
      if (seenT > 0 || i === texts.length - 1 - tail) tail = texts.length - i;
      continue;
    }
    if (!isCreditLine(texts[i])) break;
    seenT++;
    tail = texts.length - i;
  }
  if (seenT === 0) tail = 0;
  return { head, tail };
}

export function stripCreditsPlain(plain: string): string {
  const lines = plain.split(/\r?\n/);
  const { head, tail } = edges(lines);
  return lines.slice(head, lines.length - tail).join('\n').trim();
}

export function stripCreditsSynced<T extends { text: string }>(lines: readonly T[]): T[] {
  const { head, tail } = edges(lines.map((l) => l.text));
  return lines.slice(head, lines.length - tail);
}
