/* eslint-disable import/first */
jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {}, storage: { remove: () => {} } }));
jest.mock('../youtube/api', () => ({ getVideoCounterpart: jest.fn(), getVideoMeta: jest.fn(), hasAuthCookieSet: () => false, searchWebVideos: jest.fn(), searchYtmVideos: jest.fn() }));
jest.mock('./offsets', () => ({ noteVideoDuration: jest.fn() }));

import { formatViews, pickerRows, TIER_BADGE, videoThumb } from './picker';

const c = (id: string, tier: 'A' | 'B' | 'C', extra = {}) => ({ id, title: `t ${id}`, tier, score: 0.7, ch: 'Chan', dur: 215, views: 1_250_000, ...extra });

describe('picker rows', () => {
  it('formats views and thumbnails', () => {
    expect(formatViews(1_250_000)).toBe('1.3M views');
    expect(formatViews(48_000_000)).toBe('48M views');
    expect(formatViews(950)).toBe('950 views');
    expect(formatViews(undefined)).toBe('');
    expect(videoThumb('abc')).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
  });
  it('maps tiers to badges, ticks the current one and shows duration', () => {
    const rows = pickerRows([c('a', 'A'), c('b', 'B'), c('c', 'C', { verified: true })], 'b');
    expect(rows.map((r) => r.badge)).toEqual([TIER_BADGE.A, TIER_BADGE.B, TIER_BADGE.C]);
    expect(rows.map((r) => r.current)).toEqual([false, true, false]);
    expect(rows[0].duration).toBe('3:35');
    expect(rows[2].verified).toBe(true);
  });
  it('adds a row for a current video that is not in the list', () => {
    const rows = pickerRows([c('a', 'A')], 'zzz');
    expect(rows[0]).toMatchObject({ id: 'zzz', current: true });
    expect(rows).toHaveLength(2);
    expect(pickerRows([], null)).toEqual([]);
  });
});
