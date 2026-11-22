import { takeVideoStart, videoFlag } from './videoFlag';

describe('takeVideoStart', () => {
  it('hands the requested start to that track once, and drops it for any other track', () => {
    videoFlag.startAt = { id: 'aaaaaaaaaaa', sec: 60 };
    expect(takeVideoStart('aaaaaaaaaaa')).toBe(60);
    expect(takeVideoStart('aaaaaaaaaaa')).toBeUndefined();
    videoFlag.startAt = { id: 'aaaaaaaaaaa', sec: 60 };
    expect(takeVideoStart('bbbbbbbbbbb')).toBeUndefined();
    expect(videoFlag.startAt).toBeUndefined();
  });
});
