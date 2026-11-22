import { lockAxis, swipeOutcome } from './miniSwipe';

describe('lockAxis', () => {
  it('waits for the slop', () => expect(lockAxis(3, 4)).toBeUndefined());
  it('picks the dominant axis', () => {
    expect(lockAxis(20, 5)).toBe('horizontal');
    expect(lockAxis(5, 20)).toBe('vertical');
    expect(lockAxis(-30, 12)).toBe('horizontal');
  });
});

describe('swipeOutcome', () => {
  it('horizontal skips past the distance, never closes', () => {
    expect(swipeOutcome('horizontal', -100, 200)).toBe('skip-next');
    expect(swipeOutcome('horizontal', 100, 200)).toBe('skip-prev');
    expect(swipeOutcome('horizontal', 30, 0)).toBe('none');
  });
  it('vertical closes past the threshold or on a fast fling, never skips', () => {
    expect(swipeOutcome('vertical', 200, 80)).toBe('close');
    expect(swipeOutcome('vertical', 0, 30)).toBe('none');
    expect(swipeOutcome('vertical', 0, 30, 1200)).toBe('close');
    expect(swipeOutcome('vertical', 0, -90)).toBe('none');
  });
  it('no axis does nothing', () => expect(swipeOutcome(undefined, 100, 100)).toBe('none'));
});
