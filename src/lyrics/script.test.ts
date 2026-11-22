import { devanagariShare, isDevanagari, looksDevanagari } from './script';
import type { Track } from '../youtube/models';

const t = (title: string, artist = 'a'): Track => ({ kind: 'track', id: 'x', title, artists: [{ name: artist }], artwork: [] });
describe('script detection', () => {
  it('measures the Devanagari share of letters', () => {
    expect(devanagariShare('Hello')).toBe(0);
    expect(devanagariShare('नमस्ते')).toBe(1);
    expect(devanagariShare('')).toBe(0);
  });
  it('isDevanagari needs mostly Devanagari lyrics', () => {
    expect(isDevanagari({ synced: [{ time: 0, text: 'उसले तिम्रो हात' }], source: 's', providerId: 'lrcred' })).toBe(true);
    expect(isDevanagari({ plain: 'Mujhko itna bataye koyi', source: 's', providerId: 'netease' })).toBe(false);
  });
  it('looksDevanagari from title or artist', () => {
    expect(looksDevanagari(t('नगन्य माया'))).toBe(true);
    expect(looksDevanagari(t('Naganya Maya', 'सज्जन राज वैद्य'))).toBe(true);
    expect(looksDevanagari(t('Naganya Maya'))).toBe(false);
  });
});
