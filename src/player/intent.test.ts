import { INTENT_WINDOW_MS, PlaybackIntent } from './intent';

describe('PlaybackIntent', () => {
  let t = 0;
  const make = () => new PlaybackIntent(() => t);
  beforeEach(() => void (t = 1000));

  it('is inactive until a request, then for the window', () => {
    const i = make();
    expect(i.shouldResumeOnPause()).toBe(false);
    i.request();
    expect(i.shouldResumeOnPause()).toBe(true);
    t += INTENT_WINDOW_MS - 1;
    expect(i.active()).toBe(true);
    t += 2;
    expect(i.active()).toBe(false);
  });

  it.each(['user', 'remote', 'interruption'] as const)('a %s pause inside the window is never resumed', (reason) => {
    const i = make();
    i.request();
    i.cancel(reason);
    expect(i.shouldResumeOnPause()).toBe(false);
  });

  it('a new request after a cancel (user pressed play again) reopens the window', () => {
    const i = make();
    i.request();
    i.cancel('remote');
    i.request();
    expect(i.shouldResumeOnPause()).toBe(true);
  });

  it('cancel stops a loop that took a token earlier, but not one taken afterwards', () => {
    const i = make();
    i.request();
    const before = i.token();
    i.cancel('interruption');
    expect(i.cancelledSince(before)).toBe(true);
    i.request();
    expect(i.cancelledSince(i.token())).toBe(false);
  });

  it('request extends an open window', () => {
    const i = make();
    i.request();
    t += 10_000;
    i.request();
    t += 10_000;
    expect(i.active()).toBe(true);
  });
});
