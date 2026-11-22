/**
 * Android: a YouTube / YouTube Music / Spotify link opened with Sangeet is not a route. Send the router to the home screen and let
 * `useIncomingLinks` (src/ui/incomingLinks.ts) act on the link, instead of showing "not found".
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^https?:\/\//i.test(path) ? '/' : path;
}
