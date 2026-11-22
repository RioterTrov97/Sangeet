import { parseSession, shouldRestoreAtLaunch } from './launchRestore';

describe('shouldRestoreAtLaunch', () => {
  it('restores when the previous session played and a queue is saved', () => {
    expect(shouldRestoreAtLaunch({ hasSavedQueue: true, lastSessionPlayed: true })).toBe(true);
  });
  it('starts clean when the previous session never played', () => {
    expect(shouldRestoreAtLaunch({ hasSavedQueue: true, lastSessionPlayed: false })).toBe(false);
  });
  it('a restored-but-never-played session counts as not played (flag stays false)', () => {
    // session 1 played; launch 2 restores and the user never presses play: its record is played=false
    expect(shouldRestoreAtLaunch({ hasSavedQueue: true, lastSessionPlayed: parseSession({ played: false, at: 1 }) })).toBe(false);
  });
  it('does nothing without a saved queue', () => {
    expect(shouldRestoreAtLaunch({ hasSavedQueue: false, lastSessionPlayed: true })).toBe(false);
  });
});

describe('parseSession', () => {
  it('missing or malformed records mean not played', () => {
    expect(parseSession(undefined)).toBe(false);
    expect(parseSession('x')).toBe(false);
    expect(parseSession({ played: 1 })).toBe(false);
    expect(parseSession({ played: true, at: 5 })).toBe(true);
  });
});
