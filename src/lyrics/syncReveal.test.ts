import { createIdleTimer, SYNC_ARROWS_FADE_IN_MS, SYNC_ARROWS_FADE_OUT_MS, SYNC_ARROWS_HOLD_MS } from './syncReveal';

jest.mock('react-native', () => ({ Animated: { Value: class {}, timing: () => ({ start: () => {} }) } }));

describe('createIdleTimer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('expires after the hold time', () => {
    const f = jest.fn();
    createIdleTimer(f).restart();
    jest.advanceTimersByTime(SYNC_ARROWS_HOLD_MS - 1);
    expect(f).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('restarting pushes the expiry back', () => {
    const f = jest.fn();
    const t = createIdleTimer(f);
    t.restart();
    jest.advanceTimersByTime(3000);
    t.restart();
    jest.advanceTimersByTime(3000);
    expect(f).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents expiry', () => {
    const f = jest.fn();
    const t = createIdleTimer(f);
    t.restart();
    t.cancel();
    jest.advanceTimersByTime(SYNC_ARROWS_HOLD_MS * 2);
    expect(f).not.toHaveBeenCalled();
  });

  it('timings are 5 s hold, quick fade in, slower fade out', () => {
    expect(SYNC_ARROWS_HOLD_MS).toBe(5000);
    expect(SYNC_ARROWS_FADE_IN_MS).toBeLessThan(SYNC_ARROWS_FADE_OUT_MS);
  });
});
