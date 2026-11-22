import { serialRunner } from './serialRunner';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('serialRunner', () => {
  it('runs one at a time and coalesces requests during a run into one follow-up', async () => {
    let active = 0;
    let max = 0;
    let runs = 0;
    const gates: (() => void)[] = [];
    const r = serialRunner(async () => {
      runs++;
      active++;
      max = Math.max(max, active);
      await new Promise<void>((res) => gates.push(res));
      active--;
    });
    const first = r.request();
    await tick();
    expect(r.running()).toBe(true);
    const b = r.request();
    const c = r.request();
    const d = r.request();
    expect(runs).toBe(1);
    gates.shift()!();
    await first;
    await tick();
    expect(runs).toBe(2); // one follow-up for b, c and d together
    gates.shift()!();
    await Promise.all([b, c, d]);
    await tick();
    expect(runs).toBe(2);
    expect(max).toBe(1);
    expect(r.running()).toBe(false);
  });
  it('a failing run does not block the next', async () => {
    let n = 0;
    const r = serialRunner(async () => {
      if (n++ === 0) throw new Error('x');
    });
    await r.request();
    await r.request();
    expect(n).toBe(2);
  });
});
