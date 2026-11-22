import { backgroundSustained } from './sustain';

jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));

describe('backgroundSustained', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires only after the app stayed in the background', () => {
    const h = jest.fn();
    let cur = 'active';
    const feed = backgroundSustained(h, 500, () => cur);
    cur = 'background';
    feed('background');
    jest.advanceTimersByTime(499);
    expect(h).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    expect(h).toHaveBeenCalledTimes(1);
  });
  it('a quick return to active cancels it', () => {
    const h = jest.fn();
    const feed = backgroundSustained(h, 500, () => 'background');
    feed('background');
    jest.advanceTimersByTime(200);
    feed('active');
    jest.advanceTimersByTime(1000);
    expect(h).not.toHaveBeenCalled();
  });
  it('does not fire if the state is no longer background when the timer ends', () => {
    const h = jest.fn();
    const feed = backgroundSustained(h, 500, () => 'active');
    feed('background');
    jest.advanceTimersByTime(600);
    expect(h).not.toHaveBeenCalled();
  });
});
