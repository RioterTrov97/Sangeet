import { HOME_STALE_MS, homeCacheOptions } from './homeCache';

describe('homeCacheOptions', () => {
  it('is empty off TV', () => expect(homeCacheOptions(false, () => false)).toEqual({}));
  it('caches for hours on TV and never refetches on focus or reconnect', () => {
    const o = homeCacheOptions(true, () => false);
    expect(o.staleTime).toBe(HOME_STALE_MS);
    expect(HOME_STALE_MS).toBeGreaterThanOrEqual(3 * 3600_000);
    expect(o.refetchOnWindowFocus).toBe(false);
    expect(o.refetchOnReconnect).toBe(false);
  });
  it('does not refetch on mount while something plays', () => {
    let playing = true;
    const o = homeCacheOptions(true, () => playing);
    expect(o.refetchOnMount?.()).toBe(false);
    playing = false;
    expect(o.refetchOnMount?.()).toBe(true);
  });
});
