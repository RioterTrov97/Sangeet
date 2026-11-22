import { activeLineIndex } from './lrc';
import { EASE_MS, findActive, heartbeatPosition, isStalled, LOOKAHEAD_MS, SNAP_LOCAL_S, SNAP_REMOTE_S, stepClock, stepEased, STALL_MS, type ClockState } from './clockMath';
import type { LrcLine } from './types';

describe('stepClock', () => {
  it('advances by the frame delta while playing', () => {
    expect(stepClock(10, true, 16, null)).toBeCloseTo(10.016, 3);
  });
  it('stands still while paused or buffering', () => {
    expect(stepClock(10, false, 16, null)).toBe(10);
  });
  it('re-bases to the store position, even to 0', () => {
    expect(stepClock(10, true, 16, 42.5)).toBe(42.5);
    expect(stepClock(10, true, 16, 0)).toBe(0);
  });
  it('does not fling forward after a long frame gap', () => {
    expect(stepClock(10, true, 5000, null)).toBeCloseTo(10.25, 3);
    expect(stepClock(10, true, -50, null)).toBe(10);
  });
  it('keeps the active line in step with LRC timestamps over a simulated 30 s (within 0.3 s)', () => {
    const lines: LrcLine[] = Array.from({ length: 15 }, (_, i) => ({ time: i * 2 + 1.1, text: `line ${i}` }));
    let pos = 0;
    let store = 0;
    let worst = 0;
    for (let t = 0; t < 30_000; t += 16) {
      // the store reports ~4x/s with a little jitter, the clock extrapolates between reports
      const real = t / 1000;
      if (t % 250 < 16) store = real - 0.02;
      pos = stepClock(pos, true, 16, t % 250 < 16 ? store : null);
      const want = activeLineIndex(lines, real);
      const got = activeLineIndex(lines, pos);
      if (want !== got) {
        // a mismatch is only allowed within 0.3 s of a line boundary
        const edge = Math.min(...lines.map((l) => Math.abs(l.time - real)));
        worst = Math.max(worst, edge);
      }
    }
    expect(worst).toBeLessThanOrEqual(0.3);
  });
});

describe('isStalled', () => {
  it('flags a flat position after STALL_MS and not before', () => {
    expect(isStalled(1000 + STALL_MS, 1000)).toBe(false);
    expect(isStalled(1001 + STALL_MS, 1000)).toBe(true);
  });
});

describe('stepEased (remote / local clock)', () => {
  const run = (s: ClockState, playing: boolean, ms: number, snap: number, measured: (t: number) => number | null) => {
    const out: number[] = [];
    for (let t = 0; t < ms; t += 16) {
      s = stepEased(s, playing, 16, measured(t), snap);
      out.push(s.pos);
    }
    return { s, out };
  };

  it('extrapolates continuously between 1 s heartbeats while the TV says playing', () => {
    // heartbeats every 1000 ms with +-80 ms jitter in the reported position
    let st: ClockState = { pos: 5, corr: 0 };
    let prev = st.pos;
    let maxStep = 0;
    for (let t = 0; t < 10_000; t += 16) {
      const hb = t % 1000 < 16 ? 5 + t / 1000 + (((t / 1000) | 0) % 2 ? 0.08 : -0.08) : null;
      st = stepEased(st, true, 16, hb, SNAP_REMOTE_S);
      maxStep = Math.max(maxStep, Math.abs(st.pos - prev));
      expect(st.pos).toBeGreaterThanOrEqual(prev); // never steps backwards
      prev = st.pos;
    }
    expect(maxStep).toBeLessThan(0.05); // no frame moves more than ~3 frames' worth
    expect(st.pos).toBeCloseTo(15, 0);
  });

  it('folds a small drift in over EASE_MS rather than jumping', () => {
    const first = stepEased({ pos: 10, corr: 0 }, false, 16, 10.2, SNAP_REMOTE_S);
    expect(first.pos).toBeLessThan(10.02); // one frame is a small fraction of the 0.2 s drift
    const { s } = run(first, false, EASE_MS * 4, SNAP_REMOTE_S, () => null);
    expect(s.pos).toBeCloseTo(10.2, 2);
    expect(s.corr).toBeCloseTo(0, 2);
  });

  it('snaps on a seek larger than the threshold', () => {
    expect(stepEased({ pos: 10, corr: 0 }, true, 16, 60, SNAP_REMOTE_S)).toEqual({ pos: 60, corr: 0 });
    expect(stepEased({ pos: 10, corr: 0 }, true, 16, 10.9, SNAP_LOCAL_S).pos).toBe(10.9);
    expect(stepEased({ pos: 10, corr: 0 }, true, 16, 11.4, SNAP_REMOTE_S).pos).toBeLessThan(10.1);
  });

  it('stands still while the TV is paused and survives a long frame gap', () => {
    expect(stepEased({ pos: 10, corr: 0 }, false, 16, null, SNAP_REMOTE_S).pos).toBe(10);
    expect(stepEased({ pos: 10, corr: 0 }, true, 5000, null, SNAP_REMOTE_S).pos).toBeCloseTo(10.25, 3);
  });
});

describe('findActive at boundaries', () => {
  const times = [1, 3.5, 3.5, 8];
  it('is -1 before the first line and exact on the timestamp', () => {
    expect(findActive(times, 0.999)).toBe(-1);
    expect(findActive(times, 1)).toBe(0);
    expect(findActive(times, 3.499)).toBe(0);
    expect(findActive(times, 3.5)).toBe(2);
    expect(findActive(times, 100)).toBe(3);
    expect(findActive([], 5)).toBe(-1);
  });
  it('the lookahead lights a line LOOKAHEAD_MS early', () => {
    const t = 8 - LOOKAHEAD_MS / 1000;
    expect(findActive(times, t - 0.001 + LOOKAHEAD_MS / 1000)).toBe(2);
    expect(findActive(times, t + LOOKAHEAD_MS / 1000)).toBe(3);
  });
});

describe('heartbeatPosition', () => {
  it('extrapolates from the last store update only while playing, capped', () => {
    expect(heartbeatPosition(10, true, 200)).toBeCloseTo(10.2, 3);
    expect(heartbeatPosition(10, true, 5000)).toBeCloseTo(10.5, 3);
    expect(heartbeatPosition(10, false, 200)).toBe(10);
  });
});
