import { audioCheck, canEnter, exitAction, extrapolateTime, nextPhase, type Phase } from './handover';

describe('phase machine', () => {
  it('walks idle -> entering -> video -> exiting -> idle', () => {
    let p: Phase = 'idle';
    for (const [e, want] of [['enter', 'entering'], ['entered', 'video'], ['exit', 'exiting'], ['exited', 'idle']] as const) {
      p = nextPhase(p, e);
      expect(p).toBe(want);
    }
  });
  it('an aborted enter returns to idle', () => expect(nextPhase('entering', 'enter-aborted')).toBe('idle'));
  it('enter and exit cannot overlap', () => {
    expect(nextPhase('exiting', 'enter')).toBe('exiting');
    expect(nextPhase('entering', 'exit')).toBe('entering');
    expect(nextPhase('video', 'enter')).toBe('video');
    expect(canEnter('idle')).toBe(true);
    for (const p of ['entering', 'video', 'exiting'] as const) expect(canEnter(p)).toBe(false);
  });
  it('stray events do nothing', () => {
    expect(nextPhase('idle', 'exited')).toBe('idle');
    expect(nextPhase('idle', 'entered')).toBe('idle');
    expect(nextPhase('video', 'enter-aborted')).toBe('video');
  });
  it('exit requests', () => {
    expect(exitAction('idle')).toBe('ignore');
    expect(exitAction('exiting')).toBe('ignore');
    expect(exitAction('entering')).toBe('cancel-then-exit');
    expect(exitAction('video')).toBe('exit');
  });
});

describe('extrapolateTime', () => {
  it('adds the time since the last update while playing', () => expect(extrapolateTime(10, 1000, 1400, true)).toBeCloseTo(10.4));
  it('does not move while paused or unknown', () => {
    expect(extrapolateTime(10, 1000, 1400, false)).toBe(10);
    expect(extrapolateTime(10, 0, 1400, true)).toBe(10);
  });
  it('caps a stale update and ignores a clock going backwards', () => {
    expect(extrapolateTime(10, 0 + 1, 60000, true)).toBe(11);
    expect(extrapolateTime(10, 5000, 4000, true)).toBe(10);
  });
});

describe('audioCheck', () => {
  it('ok when playing near the expected position', () => expect(audioCheck('playing', 64.9, 65)).toBe('ok'));
  it('seek when playing from the start (restart)', () => expect(audioCheck('playing', 0.4, 65)).toBe('seek'));
  it('reload when not playing', () => {
    expect(audioCheck('stopped', 0, 65)).toBe('reload');
    expect(audioCheck('paused', 65, 65)).toBe('reload');
  });
});
