import { create } from 'zustand';

import { getJson, setJson } from '../../util/storage';
import type { FailureReason } from './failure';

export type HealthRecord = { at: number; source: string; ok: boolean; latencyMs: number; client?: string; reason?: FailureReason; detail?: string; kind: 'check' | 'play' };

const KEY = 'resolver.health.v1';
const MAX = 60;
/** Known-stable video used for the background check (a long-lived, always-available upload). */
export const HEALTH_VIDEO_ID = 'dQw4w9WgXcQ';

export const useHealth = create<{ records: HealthRecord[] }>(() => ({ records: getJson<HealthRecord[]>(KEY) ?? [] }));

export function recordHealth(r: HealthRecord): void {
  const records = [...useHealth.getState().records, r].slice(-MAX);
  useHealth.setState({ records });
  setJson(KEY, records);
}

/** True when the newest on-device outcomes are failures (at least two in a row, no success since). */
export function isDegraded(records: HealthRecord[], serverConfigured: boolean): boolean {
  if (serverConfigured) return false;
  const device = records.filter((r) => r.source === 'device').slice(-3);
  if (device.length < 2) return false;
  return device.slice(-2).every((r) => !r.ok);
}
