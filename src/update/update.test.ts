import { pickRelease } from './releases';
import { plainNotes, pillText, statusLine } from './text';
import { compareVersions, parseVersion } from './version';

const asset = (v: string, extra: object = {}) => ({ name: `sangeet-tv-v${v}.apk`, browser_download_url: `https://x/sangeet-tv-v${v}.apk`, size: 100, ...extra });
const rel = (tag: string, o: object = {}) => ({ tag_name: tag, draft: false, prerelease: true, body: 'notes', assets: [asset(tag.replace('v', ''))], ...o });

describe('version', () => {
  it('parses with or without v and rejects garbage', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('0.10.0')).toEqual([0, 10, 0]);
    expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3]);
    for (const bad of ['', 'v1.2', 'abc', '1.2.x', null, 5, undefined]) expect(parseVersion(bad)).toBeNull();
  });
  it('compares numerically, not as strings', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('x', '1.0.0')).toBeNull();
  });
});

describe('pickRelease', () => {
  it('picks the newest newer release, pre-releases included, regardless of order', () => {
    const r = pickRelease([rel('v0.2.0'), rel('v0.4.0'), rel('v0.3.0')], '0.1.0');
    expect(r?.version).toBe('0.4.0');
    expect(r?.apkUrl).toBe('https://x/sangeet-tv-v0.4.0.apk');
    expect(r?.notes).toBe('notes');
  });
  it('ignores drafts, the same or older versions, and releases without a TV APK', () => {
    expect(pickRelease([rel('v0.5.0', { draft: true })], '0.1.0')).toBeNull();
    expect(pickRelease([rel('v0.1.0'), rel('v0.0.9')], '0.1.0')).toBeNull();
    expect(pickRelease([rel('v0.5.0', { assets: [{ name: 'other.apk', browser_download_url: 'u' }] })], '0.1.0')).toBeNull();
    expect(pickRelease([rel('v0.6.0', { assets: [] }), rel('v0.5.0')], '0.1.0')?.version).toBe('0.5.0');
  });
  it('ignores bad tags and non-array input', () => {
    expect(pickRelease([rel('nightly')], '0.1.0')).toBeNull();
    expect(pickRelease({ message: 'rate limited' }, '0.1.0')).toBeNull();
    expect(pickRelease(null, '0.1.0')).toBeNull();
  });
  it('reads the sha256 digest when present and omits it otherwise', () => {
    const hex = 'ab'.repeat(32);
    const withD = pickRelease([rel('v0.2.0', { assets: [asset('0.2.0', { digest: `sha256:${hex}` })] })], '0.1.0');
    expect(withD?.sha256).toBe(hex);
    const without = pickRelease([rel('v0.2.0')], '0.1.0');
    expect(without && 'sha256' in without).toBe(false);
    const odd = pickRelease([rel('v0.2.0', { assets: [asset('0.2.0', { digest: 'md5:zz' })] })], '0.1.0');
    expect(odd?.sha256).toBeUndefined();
  });
});

describe('asset names', () => {
  it('accepts the universal android APK and prefers it over the tv one', () => {
    const both = rel('v0.2.0', { assets: [asset('0.2.0'), { name: 'sangeet-android-v0.2.0.apk', browser_download_url: 'https://x/android.apk', size: 1 }] });
    expect(pickRelease([both], '0.1.0')).toMatchObject({ apkUrl: 'https://x/android.apk', fileName: 'sangeet-android-v0.2.0.apk' });
    const only = rel('v0.2.0', { assets: [{ name: 'sangeet-android-v0.2.0.apk', browser_download_url: 'https://x/a.apk', size: 1 }] });
    expect(pickRelease([only], '0.1.0')?.apkUrl).toBe('https://x/a.apk');
  });
});

describe('text', () => {
  it('flattens release notes', () => {
    expect(plainNotes('## Features\n- **Lyrics** on TV\n- [Link](http://x) here\n\n<!-- c -->')).toBe('Features\n• Lyrics on TV\n• Link here');
  });
  it('describes the status', () => {
    const release = { version: '0.2.0', notes: '', apkUrl: '', size: 0, fileName: 'a.apk' };
    expect(statusLine({ status: 'downloading', progress: 0.5, release, lastChecked: 1 })).toBe('Downloading version 0.2.0, 50%');
    expect(statusLine({ status: 'idle', progress: 0, release: null, lastChecked: 1 })).toBe('Sangeet is up to date');
    expect(pillText({ status: 'ready', progress: 1, release })).toBe('Update 0.2.0 ready');
    expect(pillText({ status: 'idle', progress: 0, release })).toBeNull();
  });
});
