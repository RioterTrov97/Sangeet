import { AppState } from 'react-native';

import { log } from '../../util/log';
import { HEALTH_VIDEO_ID } from './health';
import type { ChainResolver } from './ChainResolver';

const INTERVAL_MS = 30 * 60_000;
let timer: ReturnType<typeof setInterval> | undefined;

/** Resolves a known stable video in the background; the chain records the outcome and latency in the health history. */
export async function runHealthCheck(chain: ChainResolver): Promise<void> {
  try {
    await chain.resolve(HEALTH_VIDEO_ID, { fresh: true, kind: 'check' });
  } catch {
    /* already logged and recorded by the chain */
  }
}

/** One check at boot (after a short delay so it does not compete with first playback) and one every 30 min while active. */
export function startHealthChecks(chain: ChainResolver): void {
  if (timer) return;
  setTimeout(() => void runHealthCheck(chain), 20_000);
  timer = setInterval(() => {
    if (AppState.currentState === 'active') void runHealthCheck(chain);
  }, INTERVAL_MS);
  log('resolver', 'health checks scheduled (every 30 min while active)');
}
