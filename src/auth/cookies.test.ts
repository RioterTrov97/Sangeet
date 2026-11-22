import { hasAuthCookie, headerHasAuth, isAuthError, isMusicUrl, mergeCookies, parseCookieHeader, toCookieHeader } from './cookies';

const sample = { SID: { value: 'abc' }, HSID: { value: 'def' }, SAPISID: { value: 'sap/xyz' }, '__Secure-3PAPISID': { value: 'sap/xyz' }, bad: { value: 'has space' }, empty: { value: '' } };

describe('cookies', () => {
  it('detects an auth cookie (SAPISID or __Secure-3PAPISID)', () => {
    expect(hasAuthCookie(sample)).toBe(true);
    expect(hasAuthCookie({ '__Secure-3PAPISID': { value: 'x' } })).toBe(true);
    expect(hasAuthCookie({ SID: { value: 'x' } })).toBe(false);
    expect(hasAuthCookie({ SAPISID: { value: '' } })).toBe(false);
  });
  it('builds a header, dropping unsafe and empty values', () => {
    expect(toCookieHeader(sample)).toBe('SID=abc; HSID=def; SAPISID=sap/xyz; __Secure-3PAPISID=sap/xyz');
  });
  it('mirrors __Secure-3PAPISID as SAPISID when SAPISID is missing', () => {
    expect(toCookieHeader({ '__Secure-3PAPISID': { value: 'k' }, SID: { value: 's' } })).toContain('SAPISID=k');
  });
  it('parses and checks a stored header', () => {
    expect(parseCookieHeader('a=1; b=2=3')).toEqual({ a: '1', b: '2=3' });
    expect(headerHasAuth('SID=1; SAPISID=2')).toBe(true);
    expect(headerHasAuth('SID=1')).toBe(false);
  });
  it('merges maps with later ones winning', () => {
    expect(mergeCookies({ a: { value: '1' } }, { a: { value: '2' } }).a.value).toBe('2');
  });
  it('recognises the landing host and auth errors', () => {
    expect(isMusicUrl('https://music.youtube.com/?cbrd=1')).toBe(true);
    expect(isMusicUrl('https://accounts.google.com/x?continue=https://music.youtube.com')).toBe(false);
    expect(isAuthError(new Error('Request to x failed with status code 401'))).toBe(true);
    expect(isAuthError(new Error('Request to x failed with status code 500'))).toBe(false);
  });
});
