import { stepSync, syncLabel, syncVisible, SYNC_MAX_MS } from './syncAdjust';

describe('lyrics sync control', () => {
  it('steps by half a second and stays within limits', () => {
    expect(stepSync(0, 1)).toBe(500);
    expect(stepSync(500, -1)).toBe(0);
    expect(stepSync(-500, -1)).toBe(-1000);
    expect(stepSync(SYNC_MAX_MS, 1)).toBe(SYNC_MAX_MS);
  });
  it('is shown while uncertain or adjusted; says the value once adjusted', () => {
    expect(syncVisible(undefined)).toBe(false);
    expect(syncVisible({ ms: 0, uncertain: false })).toBe(false);
    expect(syncVisible({ ms: 0, uncertain: true })).toBe(true);
    expect(syncVisible({ ms: -500, uncertain: false })).toBe(true);
    expect(syncLabel(0)).toBe('May be out of sync');
    expect(syncLabel(1500)).toBe('Sync +1.5 s');
    expect(syncLabel(-500)).toBe('Sync -0.5 s');
  });
});
