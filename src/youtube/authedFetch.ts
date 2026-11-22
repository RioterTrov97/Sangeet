/** The origin youtubei.js signs SAPISIDHASH with (`generateSidAuth`); the request's Origin must match it. */
const AUTH_ORIGIN = 'https://www.youtube.com';

/**
 * Fetch for the signed-in session. youtubei.js sets the Origin header only on server runtimes, and Google accepts a
 * SAPISIDHASH only when Origin matches the origin it was signed with, so without this every "signed-in" request is
 * answered as logged out. `credentials: 'omit'` keeps React Native's shared cookie store (anonymous YouTube cookies)
 * from replacing our Cookie header on iOS.
 */
export const authedFetch =
  (base: typeof fetch): typeof fetch =>
  (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.has('Authorization') && !headers.has('Origin')) {
      headers.set('Origin', AUTH_ORIGIN);
      headers.set('X-Origin', AUTH_ORIGIN);
    }
    return base(input, { ...init, headers, credentials: 'omit' });
  };
