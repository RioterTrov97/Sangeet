import { classifyPlayability } from '../playability';

export type FailureReason = 'rate-limited' | '403' | 'potoken' | 'decipher' | 'timeout' | 'playability' | 'network' | 'no-format' | 'server' | 'unknown';

/** Maps a raw error message to a short, stable reason so a YouTube change is obvious in the logs and health history. */
export function classifyFailure(message: string): FailureReason {
  const m = message.toLowerCase();
  if (classifyPlayability(message) === 'RateLimited') return 'rate-limited';
  if (/\b(403|410)\b|forbidden/.test(m)) return '403';
  if (/po_?token|botguard|\bmint\b|integrity|attestation/.test(m)) return 'potoken';
  if (/decipher|signature|nsig|player script|empty url|interpreter/.test(m)) return 'decipher';
  if (/timed out|timeout/.test(m)) return 'timeout';
  if (/playability|login_required|unplayable|not available|age/.test(m)) return 'playability';
  if (/no (audio|video|adaptive|muxed)|no .*formats?\b|no audio\/mp4/.test(m)) return 'no-format';
  if (/network|failed to fetch|offline|econn|unreachable|load failed/.test(m)) return 'network';
  if (/server/.test(m)) return 'server';
  return 'unknown';
}

export type Attempt = { client: string; error?: string };

/** The extractor page reports every client's outcome in `ATTEMPTS <what> <json>`; anything else is one opaque failure. */
export function parseAttempts(message: string): Attempt[] | undefined {
  const i = message.indexOf('ATTEMPTS ');
  if (i < 0) return undefined;
  const json = message.slice(message.indexOf('[', i));
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as Attempt[]) : undefined;
  } catch {
    return undefined;
  }
}
