import { createLimiter } from './limiter';

const defer = () => {
  let done!: () => void;
  const p = new Promise<void>((r) => (done = r));
  return { p, done };
};

describe('api limiter', () => {
  it('runs at most max normal calls at once, in order', async () => {
    const l = createLimiter(2);
    const order: string[] = [];
    const ds = ['a', 'b', 'c', 'd'].map(() => defer());
    const ps = ['a', 'b', 'c', 'd'].map((n, i) => l.limit(async () => (order.push(n), ds[i].p)));
    await Promise.resolve();
    expect(order).toEqual(['a', 'b']);
    expect(l.stats()).toEqual({ running: 2, waiting: 2 });
    ds[0].done();
    await ps[0];
    await Promise.resolve();
    expect(order).toEqual(['a', 'b', 'c']);
    ds[1].done();
    ds[2].done();
    ds[3].done();
    await Promise.all(ps);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });
  it('lets high priority calls jump the queue', async () => {
    const l = createLimiter(1);
    const order: string[] = [];
    const d = defer();
    const first = l.limit(async () => (order.push('first'), d.p));
    const waiting = l.limit(async () => void order.push('waiting'));
    const high = l.limit(async () => void order.push('high'), 'high');
    await high;
    expect(order).toEqual(['first', 'high']);
    d.done();
    await Promise.all([first, waiting]);
    expect(order).toEqual(['first', 'high', 'waiting']);
  });
  it('keeps going after a failure', async () => {
    const l = createLimiter(1);
    await expect(l.limit(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(l.limit(async () => 5)).resolves.toBe(5);
  });
});
