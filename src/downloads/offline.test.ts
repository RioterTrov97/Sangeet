import type { Track } from '../youtube/models';
import { offlineFailurePlan, offlineSongs, offlineTopUp } from './offline';

describe('offlineFailurePlan', () => {
  it('keeps the normal handling for a track available offline', () => {
    expect(offlineFailurePlan({ availableOffline: true, positionSec: 30 })).toBe('normal');
    expect(offlineFailurePlan({ availableOffline: true, positionSec: 0 })).toBe('normal');
  });
  it('waits to continue a streamed song that had started', () => {
    expect(offlineFailurePlan({ availableOffline: false, positionSec: 1 })).toBe('continue');
    expect(offlineFailurePlan({ availableOffline: false, positionSec: 95 })).toBe('continue');
  });
  it('waits to start a song that never started (never skips it)', () => {
    expect(offlineFailurePlan({ availableOffline: false, positionSec: 0 })).toBe('start');
    expect(offlineFailurePlan({ availableOffline: false, positionSec: 0.4 })).toBe('start');
  });
});

describe('offlineSongs', () => {
  const t = (id: string) => ({ id, title: id }) as Track;
  it('lists downloads first, then saved songs, each once', () => {
    expect(offlineSongs([t('a'), t('b')], [t('b'), t('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(offlineSongs([], [])).toEqual([]);
  });
  it('includes songs from this iPhone, last and once', () => {
    expect(offlineSongs([t('a')], [t('b')], [t('local-1'), t('a')]).map((x) => x.id)).toEqual(['a', 'b', 'local-1']);
    expect(offlineSongs([], [], [t('local-1')]).map((x) => x.id)).toEqual(['local-1']);
  });
});

describe('offlineTopUp', () => {
  const tr = (id: string) => ({ id, title: id, artists: [], artwork: [] }) as unknown as Track;
  const ids = (l: Track[]) => l.map((t) => t.id).sort();
  it('adds the saved songs that are not in the queue yet', () => {
    const plan = offlineTopUp([tr('a'), tr('b')], 1, [tr('a'), tr('c'), tr('d')]);
    expect(plan && 'append' in plan && ids(plan.append)).toEqual(['c', 'd']);
  });
  it('moves the played saved songs to the end when every saved song is queued', () => {
    const plan = offlineTopUp([tr('a'), tr('x'), tr('b'), tr('c')], 3, [tr('a'), tr('b'), tr('c')]);
    expect(plan && 'recycle' in plan && ids(plan.recycle)).toEqual(['a', 'b']);
  });
  it('tops up from songs from this iPhone like from saved songs', () => {
    const plan = offlineTopUp([tr('local-a')], 0, [tr('local-a'), tr('local-b'), tr('local-c')]);
    expect(plan && 'append' in plan && ids(plan.append)).toEqual(['local-b', 'local-c']);
  });
  it('does nothing with no saved songs', () => {
    expect(offlineTopUp([tr('a')], 0, [])).toBeNull();
    expect(offlineTopUp([tr('a')], 0, [tr('a')])).toBeNull();
  });
});
