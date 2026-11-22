/** Pure cookie helpers for the YouTube sign-in flow (unit-tested on sample strings; real cookies never appear in logs). */

export type CookieMap = Record<string, { value: string; domain?: string }>;

/** The sign-in WebView lands here after a successful login. */
export const SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com';
export const MUSIC_ORIGIN = 'https://music.youtube.com';
export const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const AUTH_NAMES = ['SAPISID', '__Secure-3PAPISID'];

export function isMusicUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'music.youtube.com';
  } catch {
    return false;
  }
}

/** Cookie names/values must be header-safe; anything else is dropped rather than risking a malformed header. */
const SAFE_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
const SAFE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

export function mergeCookies(...maps: CookieMap[]): CookieMap {
  return Object.assign({}, ...maps);
}

export function hasAuthCookie(map: CookieMap): boolean {
  return AUTH_NAMES.some((n) => !!map[n]?.value);
}

/**
 * Builds the `Cookie` header value. youtubei.js derives SAPISIDHASH from a cookie literally named `SAPISID`, so when
 * only `__Secure-3PAPISID` was issued (same secret) it is mirrored under that name.
 */
export function toCookieHeader(map: CookieMap): string {
  const entries = Object.entries(map).filter(([k, v]) => SAFE_NAME.test(k) && v?.value && SAFE_VALUE.test(v.value));
  const out = new Map(entries.map(([k, v]) => [k, v.value]));
  if (!out.has('SAPISID') && out.has('__Secure-3PAPISID')) out.set('SAPISID', out.get('__Secure-3PAPISID')!);
  return [...out].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export const headerHasAuth = (header: string): boolean => {
  const p = parseCookieHeader(header);
  return AUTH_NAMES.some((n) => !!p[n]);
};

/** True for an error from an authed InnerTube call that means the session is no longer valid. */
export function isAuthError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /status code (401|403)\b/.test(m);
}
