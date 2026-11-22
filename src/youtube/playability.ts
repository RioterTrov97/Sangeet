/**
 * Why YouTube refused to play a video, as a small set of classes with a retry policy and a user-facing message.
 * Pure (also bundled into the extractor page, which decides there whether the remaining clients are worth trying).
 * Idea as in yt-dlp's playability handling and NewPipe's typed content exceptions, reimplemented.
 */
export type PlayabilityClass = 'AgeRestricted' | 'Private' | 'Unavailable' | 'SignInConfirmNotBot' | 'MusicPremium' | 'Geographic' | 'Paid' | 'RateLimited' | 'Other';

/** Normalises curly quotes and case so "you’re" and "you're" match alike. */
const norm = (s: string) => s.replace(/[‘’]/g, "'").toLowerCase();

/** Classifies a player-response playability reason (or any error text that carries one). Order matters: the age gate also says "sign in". */
export function classifyPlayability(text: string): PlayabilityClass {
  const m = norm(text);
  if (/\b429\b|too many requests|rate.?limit|try again later/.test(m)) return 'RateLimited';
  if (/age.?(restrict|verif|check|gate)|confirm your age|inappropriate for some users|age_check_required|age_verification_required/.test(m)) return 'AgeRestricted';
  if (/not a bot|confirm you.?re not a robot|unusual traffic/.test(m)) return 'SignInConfirmNotBot';
  if (/music premium|premium members|youtube premium/.test(m)) return 'MusicPremium';
  if (/private video|video is private|this video is private|been granted access/.test(m)) return 'Private';
  if (/not available in your country|isn't available in your country|not made this video available|blocked it in your country|blocked in your country|available in your (country|region)|geo.?restrict/.test(m)) return 'Geographic';
  if (/requires payment|rent or buy|purchase|rental|join this channel|members-only|members only/.test(m)) return 'Paid';
  if (/video (is )?unavailable|no longer available|has been removed|has been terminated|account .* terminated|copyright|does not exist|playability error/.test(m)) return 'Unavailable';
  return 'Other';
}

/** Classes where no other client will do better (the video itself is the problem). */
const FINAL: ReadonlySet<PlayabilityClass> = new Set(['Private', 'MusicPremium', 'Geographic', 'Paid']);

/**
 * Clients still worth trying after one failed with `cls`. Age-restricted videos still try WEB_EMBEDDED (yt-dlp behaviour);
 * private, premium, paid and geo-blocked ones try nothing more. Rate limiting is per network, so another client will not help either.
 */
export function clientsAfter(cls: PlayabilityClass, remaining: readonly string[]): string[] {
  if (cls === 'AgeRestricted') return remaining.filter((c) => c === 'WEB_EMBEDDED');
  if (cls === 'RateLimited' || FINAL.has(cls)) return [];
  return [...remaining];
}

/** Classes that are about the video (not the client, not the network): they say nothing about a client's health. */
export const isVideoSpecific = (cls: PlayabilityClass): boolean => cls === 'AgeRestricted' || cls === 'Private' || cls === 'Unavailable' || cls === 'MusicPremium' || cls === 'Geographic' || cls === 'Paid';

/** Short message for a toast / notice (phone and TV; the TV has no keyboard to debug with). */
export function playabilityMessage(cls: PlayabilityClass, retryInMs?: number): string {
  switch (cls) {
    case 'AgeRestricted':
      return "This song is age-restricted and can't be played here.";
    case 'Private':
      return 'This song is private.';
    case 'Unavailable':
      return 'This song is no longer available.';
    case 'SignInConfirmNotBot':
      return 'YouTube wants to verify this device. Try again in a while.';
    case 'MusicPremium':
      return 'This song needs YouTube Music Premium.';
    case 'Geographic':
      return "This song isn't available in your country.";
    case 'Paid':
      return 'This is paid content and cannot be played here.';
    case 'RateLimited': {
      const n = Math.max(1, Math.ceil((retryInMs ?? 15 * 60_000) / 60_000));
      return `YouTube is limiting requests from this network. Try again in ${n} ${n === 1 ? 'minute' : 'minutes'}.`;
    }
    default:
      return "Can't play right now";
  }
}
