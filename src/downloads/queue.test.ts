import { planEviction } from './lru';
import { DownloadQueue, type Job } from './queue';

const flush = () => new Promise((r) => setImmediate(r));

function make(runner: (id: string) => Promise<{ bytes: number }>, extra: Partial<ConstructorParameters<typeof DownloadQueue>[0]> = {}) {
  const log: Job[] = [];
  const q = new DownloadQueue({ runner, onChange: (j) => log.push({ ...j }), backoff: () => 0, setTimer: (fn) => setTimeout(fn, 0), ...extra });
  return { q, log };
}

describe('DownloadQueue', () => {
  it('runs at most 3 jobs at once', async () => {
    let active = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const { q } = make(
      (id) =>
        new Promise((res) => {
          active++;
          peak = Math.max(peak, active);
          gates.push(() => (active--, res({ bytes: 10 })));
        }),
    );
    ['a', 'b', 'c', 'd', 'e'].forEach((id) => q.enqueue(id));
    await flush();
    expect(peak).toBe(3);
    gates.splice(0).forEach((g) => g());
    await flush();
    await flush();
    gates.splice(0).forEach((g) => g());
    await flush();
    expect([...q.jobs.values()].every((j) => j.state === 'done')).toBe(true);
  });

  it('retries 3 times then fails permanently; retry() revives', async () => {
    let calls = 0;
    const { q } = make(async () => {
      calls++;
      throw new Error('boom');
    });
    q.enqueue('a');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(3);
    expect(q.jobs.get('a')).toMatchObject({ state: 'failed', attempts: 3, error: 'boom' });
    q.retry('a');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(6);
  });

  it('succeeds after a transient failure', async () => {
    let calls = 0;
    const { q } = make(async () => {
      if (++calls < 2) throw new Error('flaky');
      return { bytes: 7 };
    });
    q.enqueue('a');
    await new Promise((r) => setTimeout(r, 30));
    expect(q.jobs.get('a')).toMatchObject({ state: 'done', bytes: 7 });
  });

  it('holds jobs while the gate is closed and starts them on pump', async () => {
    let closed: string | undefined = 'wifi only';
    const { q } = make(async () => ({ bytes: 1 }), { gate: () => closed });
    q.enqueue('a');
    await flush();
    expect(q.jobs.get('a')?.state).toBe('queued');
    closed = undefined;
    q.pump();
    await flush();
    expect(q.jobs.get('a')?.state).toBe('done');
  });

  it('a removed job is not resurrected when its run finishes', async () => {
    let finish!: () => void;
    const { q } = make(() => new Promise((res) => (finish = () => res({ bytes: 1 }))));
    q.enqueue('a');
    await flush();
    q.remove('a');
    finish();
    await flush();
    expect(q.jobs.has('a')).toBe(false);
  });
});

describe('planEviction (LRU)', () => {
  const it = (trackId: string, bytes: number, lastPlayedAt: number, pinned = false) => ({ trackId, bytes, pinned, lastPlayedAt, updatedAt: 0 });
  it_('evicts least recently played non-pinned first', () => {
    expect(planEviction([it('a', 10, 3), it('b', 10, 1), it('c', 10, 2)], 20)).toEqual(['b']);
  });
  it_('never evicts pinned or protected items', () => {
    expect(planEviction([it('a', 10, 1, true), it('b', 10, 2), it('c', 10, 3)], 10, new Set(['b']))).toEqual(['c']);
  });
  it_('does nothing when unlimited or under the limit', () => {
    expect(planEviction([it('a', 100, 1)], 0)).toEqual([]);
    expect(planEviction([it('a', 5, 1)], 10)).toEqual([]);
  });
  function it_(name: string, fn: () => void) {
    test(name, fn);
  }
});
