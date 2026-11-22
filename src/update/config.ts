import Constants from 'expo-constants';

import { devDriverEnabled } from '../dev/flags';
import { releasesUrl } from './releases';

/**
 * Where releases are fetched from, or null when the updater is off (the default: no network calls, no UI).
 * `extra.updateRepo` is SANGEET_UPDATE_REPO (owner/name) read in app.config.ts. `extra.updateFeed` (SANGEET_UPDATE_FEED, a full
 * releases URL for testing against a local server) is only emitted into debug and screenshot builds, and is ignored here
 * unless the dev hooks are enabled, so a release build can never be pointed elsewhere.
 */
export function updateFeedUrl(): string | null {
  const extra = Constants.expoConfig?.extra ?? {};
  if (devDriverEnabled && typeof extra.updateFeed === 'string' && extra.updateFeed) return extra.updateFeed;
  const repo = extra.updateRepo;
  return typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) ? releasesUrl(repo) : null;
}

export const currentVersion = (): string => Constants.expoConfig?.version ?? '0.0.0';
