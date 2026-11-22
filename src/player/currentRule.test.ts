import { pressAction } from './currentRule';

describe('pressAction', () => {
  it('plays a different or first song', () => {
    expect(pressAction({ currentId: 'a', status: 'playing' }, 'b')).toBe('play');
    expect(pressAction({ status: 'idle' }, 'b')).toBe('play');
  });
  it('plays when the current song is stopped (idle)', () => {
    expect(pressAction({ currentId: 'a', status: 'idle' }, 'a')).toBe('play');
  });
  it('opens, never restarts, the current song', () => {
    expect(pressAction({ currentId: 'a', status: 'playing' }, 'a')).toBe('open');
    expect(pressAction({ currentId: 'a', status: 'buffering' }, 'a')).toBe('open');
  });
  it('resumes a paused current song', () => {
    expect(pressAction({ currentId: 'a', status: 'paused' }, 'a')).toBe('resume');
  });
});
