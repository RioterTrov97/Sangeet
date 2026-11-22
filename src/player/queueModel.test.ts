import type { Track } from '../youtube/models';
import { append, clearUpcoming, dedupe, insertNext, move, needsRadio, radioSeeds, removeAt, shuffleKeepingCurrent, unshuffle } from './queueModel';

const t = (id: string): Track => ({ kind: 'track', id, title: id, artists: [], artwork: [] });
const ids = (q: Track[]) => q.map((x) => x.id).join('');
const q = ['a', 'b', 'c', 'd', 'e'].map(t);

describe('queueModel', () => {
  it('dedupes by id keeping the first', () => {
    expect(ids(dedupe(['a', 'b', 'a', 'c', 'b'].map(t)))).toBe('abc');
  });

  it('insertNext places the track after the current one and moves existing duplicates', () => {
    expect(ids(insertNext(q, 1, t('z')).queue)).toBe('abzcde');
    const moved = insertNext(q, 1, t('e'));
    expect(ids(moved.queue)).toBe('abecd');
    expect(moved.index).toBe(1);
    const before = insertNext(q, 3, t('a')); // removing an earlier duplicate shifts the current index
    expect(ids(before.queue)).toBe('bcdae');
    expect(before.index).toBe(2);
    expect(insertNext([], 0, t('x')).queue).toHaveLength(1);
  });

  it('append skips tracks already queued', () => {
    expect(ids(append(q, ['e', 'f', 'f', 'g'].map(t)))).toBe('abcdefg');
  });

  it('removeAt adjusts the current index and refuses to remove the current track', () => {
    expect(removeAt(q, 2, 0)).toMatchObject({ index: 1 });
    expect(ids(removeAt(q, 2, 4).queue)).toBe('abcd');
    expect(removeAt(q, 2, 2).queue).toBe(q);
  });

  it('move keeps pointing at the current track', () => {
    const r = move(q, 1, 3, 0);
    expect(ids(r.queue)).toBe('dabce');
    expect(r.index).toBe(2);
    expect(ids(move(q, 0, 0, 4).queue)).toBe('bcdea');
    expect(move(q, 0, 0, 4).index).toBe(4);
  });

  it('clearUpcoming keeps history and the current track', () => {
    expect(ids(clearUpcoming(q, 2))).toBe('abc');
  });

  it('shuffle keeps the current track first; unshuffle restores order plus additions', () => {
    const s = shuffleKeepingCurrent(q, 2, () => 0.3);
    expect(s.queue[0].id).toBe('c');
    expect(s.index).toBe(0);
    expect(ids(s.queue.slice().sort((x, y) => x.id.localeCompare(y.id)))).toBe('abcde');
    const withExtra = [...s.queue, t('z')];
    expect(ids(unshuffle(withExtra, q).queue)).toBe('abcdez');
  });

  it('needsRadio fires under 3 upcoming tracks only when repeat is off', () => {
    expect(needsRadio(q, 0, 'off')).toBe(false); // 4 upcoming
    expect(needsRadio(q, 2, 'off')).toBe(true); // 2 upcoming
    expect(needsRadio(q, 4, 'all')).toBe(false);
    expect(needsRadio([], 0, 'off')).toBe(false);
  });
});

describe('radioSeeds', () => {
  const q = ['a', 'b', 'c', 'd'].map((id) => ({ kind: 'track' as const, id, title: id, artists: [], artwork: [] }));
  it('starts from the last song, then the current one, then the rest from the end', () => {
    expect(radioSeeds(q, 1).map((t) => t.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(radioSeeds(q, 3, 2).map((t) => t.id)).toEqual(['d', 'c']);
    expect(radioSeeds([], 0)).toEqual([]);
  });
});
