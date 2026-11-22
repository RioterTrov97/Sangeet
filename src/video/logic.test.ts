import { normalizeArtist, normalizeTitle } from '../lyrics/normalize';
import { audioHasStarted, fadeGains, handoverExpired, loopsInPlace, nextModeAfterAdvance, pickVideoMatch, radioFilter, shouldAcceptVideoTime, switchPosition, syncPlan, videoIdFor } from './logic';
import { preferOfficial } from '../youtube/official';

describe('switchPosition', () => {
  it('keeps normal positions', () => expect(switchPosition(42.5, 200)).toBe(42.5));
  it('clamps junk to 0', () => {
    expect(switchPosition(NaN, 200)).toBe(0);
    expect(switchPosition(-3, 200)).toBe(0);
  });
  it('does not start at the very end', () => expect(switchPosition(200, 200)).toBe(199.5));
  it('passes through when duration unknown', () => expect(switchPosition(90)).toBe(90));
});

describe('video availability and advance', () => {
  it('uses the track itself when it is a video', () => expect(videoIdFor({ id: 'a', isVideo: true }, 'b')).toBe('a'));
  it('uses the counterpart otherwise', () => {
    expect(videoIdFor({ id: 'a' }, 'b')).toBe('b');
    expect(videoIdFor({ id: 'a' }, null)).toBeNull();
    expect(videoIdFor({ id: 'a' }, undefined)).toBeNull();
  });
  it('keeps video mode only if the next track has a video', () => {
    expect(nextModeAfterAdvance('v1')).toEqual({ kind: 'video', videoId: 'v1' });
    expect(nextModeAfterAdvance(null)).toEqual({ kind: 'song' });
  });
  it('rejects bogus times', () => {
    expect(shouldAcceptVideoTime(10, NaN, false)).toBe(false);
    expect(shouldAcceptVideoTime(10, 10.3, false)).toBe(true);
    expect(shouldAcceptVideoTime(10, 2, false)).toBe(false);
    expect(shouldAcceptVideoTime(10, 2, true)).toBe(true);
  });
});

describe('pickVideoMatch', () => {
  const song = { id: 's', title: 'Blinding Lights', artists: [{ name: 'The Weeknd' }], durationSec: 202 };
  const pick = (c: any[]) => pickVideoMatch(song, c, normalizeTitle, normalizeArtist);
  it('prefers the official video within the duration window', () => {
    expect(pick([
      { id: 'lyr', title: 'The Weeknd - Blinding Lights (Lyrics)', artists: [{ name: 'Lyric Chan' }], durationSec: 203 },
      { id: 'omv', title: 'Blinding Lights (Official Video)', artists: [{ name: 'The Weeknd' }], durationSec: 262 },
    ])).toBe('omv');
  });
  it('rejects covers, other artists and wildly different lengths', () => {
    expect(pick([
      { id: 'cov', title: 'Blinding Lights (Cover)', artists: [{ name: 'The Weeknd' }], durationSec: 205 },
      { id: 'oth', title: 'Blinding Lights', artists: [{ name: 'Someone' }], durationSec: 205 },
      { id: 'long', title: 'Blinding Lights (1 hour)', artists: [{ name: 'The Weeknd' }], durationSec: 3600 },
    ])).toBeNull();
  });
});

describe('official first', () => {
  const norm = (s: string) => s;
  it('Numb: the artist channel beats a re-upload that names the artist', () => {
    const song = { id: 's', title: 'Numb', artists: [{ name: 'Linkin Park' }], durationSec: 187 };
    expect(pickVideoMatch(song, [
      { id: 'hq', title: 'Linkin Park - Numb (HQ)', artists: [{ name: 'HighQualityMusic44' }], durationSec: 188, videoType: 'ugc' },
      { id: 'omv', title: 'Numb (Official Music Video) [4K UPGRADE] – Linkin Park', artists: [{ name: 'Linkin Park' }], durationSec: 187, videoType: 'official' },
    ], normalizeTitle, normalizeArtist)).toBe('omv');
  });
  it('Whatever It Takes: an AMV is never picked', () => {
    const song = { id: 's', title: 'Whatever It Takes', artists: [{ name: 'Imagine Dragons' }], durationSec: 201 };
    expect(pickVideoMatch(song, [
      { id: 'amv', title: 'Naruto AMV - Whatever It Takes (Imagine Dragons)', artists: [{ name: 'AMV Maker' }], durationSec: 205, videoType: 'ugc' },
    ], normalizeTitle, normalizeArtist)).toBeNull();
  });
  it('VEVO channel counts as the artist', () => {
    const song = { id: 's', title: 'Whatever It Takes', artists: [{ name: 'Imagine Dragons' }], durationSec: 201 };
    expect(pickVideoMatch(song, [
      { id: 'up', title: 'Imagine Dragons - Whatever It Takes', artists: [{ name: 'Some Fan' }], durationSec: 202, videoType: 'ugc' },
      { id: 'vevo', title: 'Imagine Dragons - Whatever It Takes (Official Music Video)', artists: [{ name: 'ImagineDragonsVEVO' }], durationSec: 230 },
    ], normalizeTitle, normalizeArtist)).toBe('vevo');
  });
  it('a user upload is used only when nothing official exists', () => {
    const song = { id: 's', title: 'Rare Song', artists: [{ name: 'Small Band' }], durationSec: 200 };
    expect(pickVideoMatch(song, [
      { id: 'up', title: 'Small Band - Rare Song', artists: [{ name: 'Fan' }], durationSec: 201, videoType: 'ugc' },
    ], normalizeTitle, normalizeArtist)).toBe('up');
  });
  it('no official video: the most viewed strict match wins', () => {
    const song = { id: 's', title: 'Rare Song', artists: [{ name: 'Small Band' }], durationSec: 200 };
    expect(pickVideoMatch(song, [
      { id: 'few', title: 'Small Band - Rare Song', artists: [{ name: 'Fan A' }], durationSec: 200, videoType: 'ugc', views: 4_000 },
      { id: 'many', title: 'Small Band - Rare Song (Full)', artists: [{ name: 'Fan B' }], durationSec: 203, videoType: 'ugc', views: 2_500_000 },
      { id: 'cover', title: 'Small Band - Rare Song (cover)', artists: [{ name: 'Fan C' }], durationSec: 201, videoType: 'ugc', views: 90_000_000 },
      { id: 'wrong', title: 'Other Band - Rare Song', artists: [{ name: 'Fan D' }], durationSec: 200, videoType: 'ugc', views: 90_000_000 },
      { id: 'short', title: 'Small Band - Rare Song', artists: [{ name: 'Fan E' }], durationSec: 100, videoType: 'ugc', views: 90_000_000 },
    ], normalizeTitle, normalizeArtist)).toBe('many');
  });
  it('an official match still beats a far more viewed upload', () => {
    const song = { id: 's', title: 'Rare Song', artists: [{ name: 'Small Band' }], durationSec: 200 };
    expect(pickVideoMatch(song, [
      { id: 'up', title: 'Small Band - Rare Song', artists: [{ name: 'Fan' }], durationSec: 200, videoType: 'ugc', views: 99_000_000 },
      { id: 'omv', title: 'Rare Song', artists: [{ name: 'Small Band' }], durationSec: 205, videoType: 'official', views: 10 },
    ], normalizeTitle, normalizeArtist)).toBe('omv');
  });
  it('Dashain Tihar: the track IS the official video (radio item, no label) and is its own match', () => {
    const song = { id: 'LnOajzcjBz4', title: 'Dashain Tihar', artists: [{ name: 'Sugam Pokharel' }], durationSec: 239 };
    const cands = [
      { id: 'LnOajzcjBz4', title: 'Dashain Tihar', artists: [{ name: 'Sugam Pokharel' }], durationSec: 239, videoType: 'official' as const, views: 53_000_000 },
      { id: 'GI153LgNrig', title: 'Dashain Tihar', artists: [{ name: 'Sugam Pokharel' }], durationSec: 227, videoType: 'song' as const },
    ];
    expect(pickVideoMatch(song, cands, normalizeTitle, normalizeArtist)).toBe('LnOajzcjBz4');
    // an audio-only song never matches itself
    expect(pickVideoMatch({ ...song, id: 'GI153LgNrig', videoType: 'song' }, cands.slice(1), normalizeTitle, normalizeArtist)).toBeNull();
  });
  it('official tracks hide user uploads in a list; uploads alone stay', () => {
    const t = (id: string, videoType?: string) => ({ kind: 'track' as const, id, title: id, artists: [], artwork: [], videoType: videoType as any });
    expect(preferOfficial([t('a', 'song'), t('b', 'ugc'), t('c', 'official')]).map((x) => x.id)).toEqual(['a', 'c']);
    expect(preferOfficial([t('b', 'ugc'), t('d', 'ugc')]).map((x) => x.id)).toEqual(['b', 'd']);
  });
  it('radio drops covers and uploads, unless the seed is a cover', () => {
    const r = (id: string, title: string, videoType?: string) => ({ id, title, artists: [], videoType });
    const list = [r('a', 'Believer', 'song'), r('b', 'Believer (Piano Cover)', 'ugc'), r('c', 'Thunder Instrumental', 'ugc'), r('d', 'Demons', 'ugc')];
    expect(radioFilter(list, r('s', 'Natural', 'song')).map((x) => x.id)).toEqual(['a']);
    expect(radioFilter(list, r('s', 'Natural (Piano Cover)', 'ugc')).map((x) => x.id)).toEqual(['a']);
    void norm;
  });
});

describe('handover helpers', () => {
  it('syncPlan only seeks when the drift is above tolerance', () => {
    expect(syncPlan(10.1, 10)).toEqual({ seek: false });
    expect(syncPlan(9.75, 10)).toEqual({ seek: false });
    expect(syncPlan(8, 10)).toEqual({ seek: true, to: 10.25 });
    expect(syncPlan(12, 10)).toEqual({ seek: true, to: 10.25 });
    expect(syncPlan(NaN, 10)).toEqual({ seek: false });
  });
  it('fadeGains is equal-power from 1/0 to 0/1', () => {
    expect(fadeGains(0, 5)).toEqual({ out: 1, in: 0 });
    const end = fadeGains(5, 5);
    expect(end.out).toBeCloseTo(0);
    expect(end.in).toBeCloseTo(1);
    const mid = fadeGains(2.5, 5);
    expect(mid.out ** 2 + mid.in ** 2).toBeCloseTo(1);
  });
  it('handoverExpired / audioHasStarted', () => {
    expect(handoverExpired(0, 7999, 8000)).toBe(false);
    expect(handoverExpired(0, 8000, 8000)).toBe(true);
    expect(audioHasStarted('playing', 10.5, 10.25)).toBe(true);
    expect(audioHasStarted('playing', 10.25, 10.25)).toBe(false);
    expect(audioHasStarted('buffering', 11, 10)).toBe(false);
  });
});

describe('loopsInPlace', () => {
  it('repeat-one always restarts in place; repeat-all only over a one-song queue', () => {
    expect(loopsInPlace('one', 5)).toBe(true);
    expect(loopsInPlace('all', 1)).toBe(true);
    expect(loopsInPlace('all', 3)).toBe(false);
    expect(loopsInPlace('off', 1)).toBe(false);
  });
});

describe('repeat restart and the video time guard', () => {
  it('a backward jump to the start is dropped unless it is marked as a seek (the stuck progress bar)', () => {
    expect(shouldAcceptVideoTime(212, 0.3, false)).toBe(false);
    expect(shouldAcceptVideoTime(212, 0.3, true)).toBe(true);
  });
});
