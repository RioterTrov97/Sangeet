import { classifyPlayability, clientsAfter, playabilityMessage } from './playability';
import { RateLimitCooldown } from './resolver/cooldown';
import { clearFailureNotes, failureHaltsQueue, failureMessage, noteFailure } from './resolver/lastFailure';

describe('classifyPlayability (real reason strings)', () => {
  const table: [string, ReturnType<typeof classifyPlayability>][] = [
    ['playability LOGIN_REQUIRED: Sign in to confirm your age', 'AgeRestricted'],
    ['playability LOGIN_REQUIRED: This video may be inappropriate for some users.', 'AgeRestricted'],
    ['playability AGE_VERIFICATION_REQUIRED: ', 'AgeRestricted'],
    ["playability LOGIN_REQUIRED: Sign in to confirm you're not a bot", 'SignInConfirmNotBot'],
    ['playability LOGIN_REQUIRED: Sign in to confirm you’re not a bot', 'SignInConfirmNotBot'],
    ['playability LOGIN_REQUIRED: This video is private', 'Private'],
    ["playability LOGIN_REQUIRED: Sign in if you've been granted access to this video", 'Private'],
    ['playability UNPLAYABLE: This video is only available to Music Premium members', 'MusicPremium'],
    ['playability UNPLAYABLE: The uploader has not made this video available in your country', 'Geographic'],
    ["playability UNPLAYABLE: This video isn't available in your country", 'Geographic'],
    ['playability UNPLAYABLE: This video requires payment to watch', 'Paid'],
    ['playability UNPLAYABLE: Join this channel to get access to members-only content like this video', 'Paid'],
    ['playability ERROR: Video unavailable', 'Unavailable'],
    ['playability UNPLAYABLE: This video is no longer available because the YouTube account associated with this video has been terminated.', 'Unavailable'],
    ['playability UNPLAYABLE: This video has been removed by the uploader', 'Unavailable'],
    ['playability LOGIN_REQUIRED: This content isn’t available, try again later', 'RateLimited'],
    ['Request failed with status 429', 'RateLimited'],
    ['too many requests', 'RateLimited'],
    ['validation HTTP 403', 'Other'],
    ['no streaming data', 'Other'],
    ['Bridge request "getStream" timed out after 60000ms', 'Other'],
    ['503 Service Unavailable', 'Other'],
    ['', 'Other'],
  ];
  it.each(table)('%s -> %s', (text, cls) => expect(classifyPlayability(text)).toBe(cls));
});

describe('clientsAfter', () => {
  const rest = ['TV', 'MWEB', 'WEB_EMBEDDED'];
  it('age-restricted still tries WEB_EMBEDDED only', () => expect(clientsAfter('AgeRestricted', rest)).toEqual(['WEB_EMBEDDED']));
  it('private, premium, paid, geographic try nothing more', () => {
    for (const c of ['Private', 'MusicPremium', 'Paid', 'Geographic'] as const) expect(clientsAfter(c, rest)).toEqual([]);
  });
  it('rate limited tries nothing more (per network)', () => expect(clientsAfter('RateLimited', rest)).toEqual([]));
  it('bot check, unavailable and other keep trying', () => {
    for (const c of ['SignInConfirmNotBot', 'Unavailable', 'Other'] as const) expect(clientsAfter(c, rest)).toEqual(rest);
  });
});

describe('playabilityMessage', () => {
  it('rate limit says how many minutes', () => {
    expect(playabilityMessage('RateLimited', 15 * 60_000)).toBe('YouTube is limiting requests from this network. Try again in 15 minutes.');
    expect(playabilityMessage('RateLimited', 30_000)).toBe('YouTube is limiting requests from this network. Try again in 1 minute.');
  });
  it('has a short text for every class', () => {
    for (const c of ['AgeRestricted', 'Private', 'Unavailable', 'SignInConfirmNotBot', 'MusicPremium', 'Geographic', 'Paid', 'RateLimited', 'Other'] as const) expect(playabilityMessage(c).length).toBeLessThan(80);
  });
});

describe('RateLimitCooldown', () => {
  it('15 minutes, then 30, then 60 (cap) on repeats; success resets', () => {
    let t = 0;
    const c = new RateLimitCooldown(() => t);
    expect(c.active()).toBe(false);
    c.trip();
    expect(c.remainingMs()).toBe(15 * 60_000);
    t += 5 * 60_000;
    c.trip(); // still running: not extended
    expect(c.remainingMs()).toBe(10 * 60_000);
    t += 10 * 60_000;
    expect(c.active()).toBe(false);
    c.trip();
    expect(c.remainingMs()).toBe(30 * 60_000);
    t += 30 * 60_000;
    c.trip();
    expect(c.remainingMs()).toBe(60 * 60_000);
    t += 60 * 60_000;
    c.trip();
    expect(c.remainingMs()).toBe(60 * 60_000);
    c.success();
    expect(c.active()).toBe(false);
    c.trip();
    expect(c.remainingMs()).toBe(15 * 60_000);
  });
});

describe('lastFailure', () => {
  beforeEach(clearFailureNotes);
  it('gives the typed message for a recent failure only, and halts the queue for rate limits', () => {
    noteFailure('v:abc', 'Private', undefined, 1000);
    expect(failureMessage('abc', 2000)).toBe('This song is private.');
    expect(failureMessage('abc', 1000 + 61_000)).toBeUndefined();
    expect(failureHaltsQueue('abc')).toBe(false);
    noteFailure('rl', 'RateLimited', 15 * 60_000, 1000);
    expect(failureMessage('rl', 1000 + 5 * 60_000)).toContain('10 minutes');
    expect(failureHaltsQueue('rl')).toBe(true);
    noteFailure('x', 'Other', undefined, 1000);
    expect(failureMessage('x', 1001)).toBeUndefined();
  });
});
