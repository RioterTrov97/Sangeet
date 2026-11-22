import { parseSpotifyLink, type SpotifyRef } from '../import/spotify';
import { parseMusicLink, type MusicLink } from './musicLink';

/** What a shared text or opened URL asks Sangeet to do. */
export type SharedTarget = { kind: 'music'; link: MusicLink } | { kind: 'spotify'; ref: SpotifyRef; text: string };

const URL_RE = /(?:https?|sangeet):\/\/[^\s<>"']+/gi;

/** URLs in a share text ("Listen to X https://youtu.be/... " is typical), in order, without trailing punctuation. */
export function urlsIn(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => u.replace(/[).,;!?]+$/, ''));
}

/** The first link in `text` that Sangeet understands (YouTube / YouTube Music, or a Spotify playlist or album), else undefined. */
export function parseShared(text: string | null | undefined): SharedTarget | undefined {
  if (!text) return undefined;
  for (const url of urlsIn(text)) {
    const link = parseMusicLink(url);
    if (link) return { kind: 'music', link };
    const ref = parseSpotifyLink(url);
    if (ref) return { kind: 'spotify', ref, text: url };
  }
  return undefined;
}
