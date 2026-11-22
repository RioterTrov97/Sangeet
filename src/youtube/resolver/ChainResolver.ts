import { log, logWarn } from '../../util/log';
import { classifyPlayability, isVideoSpecific, type PlayabilityClass } from '../playability';
import { RateLimitCooldown } from './cooldown';
import { CircuitBreaker } from './breaker';
import { ClientExclusions } from './clientExclusion';
import { classifyFailure, parseAttempts, type FailureReason } from './failure';
import { recordHealth } from './health';
import type { ResolvedStream, StreamResolver } from './types';

/**
 * On-device client order (as in yt-dlp / NewPipe): VISIONOS (no JS player, no PO token), TV as tv_samsung, then MWEB with the
 * GVS PO token, then WEB_EMBEDDED. IOS and ANDROID are never used (their URLs stop after 1 MiB; ANDROID_VR 403s everywhere).
 */
export const DEVICE_CLIENTS = ['VISIONOS', 'TV', 'MWEB', 'WEB_EMBEDDED'] as const;

/** Pure client selection: breaker-open clients are dropped; per-video exclusions and `avoid` push clients back; when the exclusions leave nothing, every non-breaker client is retried (low quality). */
export function selectClients(open: readonly string[], excluded: (c: string) => boolean, avoid: readonly string[] = []): { clients: string[]; lowQuality: boolean } {
  const usable = open.filter((c) => !excluded(c));
  if (usable.length === 0) return { clients: [...open], lowQuality: open.length > 0 };
  const preferred = usable.filter((c) => !avoid.includes(c));
  return { clients: [...preferred, ...usable.filter((c) => !preferred.includes(c))], lowQuality: false };
}
const SERVER = 'server';

export type ChainOptions = {
  device: StreamResolver;
  server?: StreamResolver;
  /** Whether a backup server is configured right now. */
  serverConfigured: () => boolean;
  /** Dev flag: never touch the on-device path. */
  serverOnly?: () => boolean;
  breaker?: CircuitBreaker;
  exclusions?: ClientExclusions;
  record?: typeof recordHealth;
  now?: () => number;
};

type Reason = { source: string; reason: FailureReason; detail: string; cls?: PlayabilityClass };

/** `playability` is why YouTube refused (Other when unknown); `retryInMs` is set while a rate-limit cool-down runs. */
export class ResolveError extends Error {
  constructor(
    message: string,
    readonly reasons: Reason[],
    readonly playability: PlayabilityClass = 'Other',
    readonly retryInMs?: number,
  ) {
    super(message);
  }
}

/** The most telling class among the reasons: rate limiting first (it explains everything), then the first specific one. */
export function summarizeClass(reasons: readonly Reason[]): PlayabilityClass {
  if (reasons.some((r) => r.cls === 'RateLimited')) return 'RateLimited';
  return reasons.find((r) => r.cls && r.cls !== 'Other')?.cls ?? 'Other';
}

/**
 * OnDevice (each client behind its own circuit breaker) -> PersonalServer (if configured) -> fail.
 * After 3 consecutive failures a source is skipped for 10 minutes. Every attempt is logged with its reason.
 */
export class ChainResolver implements StreamResolver {
  readonly breaker: CircuitBreaker;
  readonly exclusions: ClientExclusions;
  readonly cooldown: RateLimitCooldown;
  private readonly record: typeof recordHealth;
  private readonly now: () => number;

  constructor(private readonly o: ChainOptions) {
    this.breaker = o.breaker ?? new CircuitBreaker();
    this.exclusions = o.exclusions ?? new ClientExclusions(o.now);
    this.record = o.record ?? recordHealth;
    this.now = o.now ?? Date.now;
    this.cooldown = new RateLimitCooldown(this.now);
  }

  async resolve(videoId: string, opts?: { fresh?: boolean; kind?: 'check' | 'play'; /** Clients whose URL just failed mid-stream (403): try the others first. */ avoid?: string[] }): Promise<ResolvedStream> {
    const reasons: Reason[] = [];
    const kind = opts?.kind ?? 'play';

    if (!this.o.serverOnly?.() && this.cooldown.active()) {
      // YouTube is rate limiting this network: no on-device resolves (they would only extend it) until the cool-down ends.
      reasons.push({ source: 'device', reason: 'rate-limited', detail: `cooling down for ${Math.ceil(this.cooldown.remainingMs() / 60_000)} min`, cls: 'RateLimited' });
      log('resolver', `on-device skipped: rate-limit cool-down, ${Math.ceil(this.cooldown.remainingMs() / 1000)}s left`);
    } else if (!this.o.serverOnly?.()) {
      const open = DEVICE_CLIENTS.filter((c) => !this.breaker.isOpen(c));
      // A client that failed for this video in the last 5 minutes is skipped; one whose URLs just 403'd mid-stream goes to the back
      // of the line. When that leaves nothing, all clients are retried at low quality as a last resort.
      const { clients, lowQuality } = selectClients(open, (c) => this.exclusions.isExcluded(videoId, c), opts?.avoid);
      if (lowQuality) log('resolver', `${videoId}: every client failed within 5 min; last resort: all clients, low quality`);
      if (clients.length === 0) {
        reasons.push({ source: 'device', reason: 'unknown', detail: 'all clients cooling down after repeated failures' });
        log('resolver', 'on-device skipped: every client is in cooldown');
      } else {
        const t0 = this.now();
        try {
          const s = await this.o.device.resolve(videoId, { fresh: opts?.fresh || lowQuality, clients: [...clients], lowQuality });
          for (const f of s.failed ?? []) this.fail(f.client, f.error ?? 'failed', reasons, videoId);
          if (s.client) this.breaker.success(s.client);
          this.cooldown.success();
          log('resolver', `${videoId} via device/${s.client ?? '?'}${s.failed?.length ? ` after ${s.failed.map((f) => f.client).join(',')} failed` : ''}`);
          this.record({ at: this.now(), source: 'device', ok: true, latencyMs: this.now() - t0, client: s.client, kind });
          return s;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const attempts = parseAttempts(msg);
          if (attempts) for (const a of attempts) this.fail(a.client, a.error ?? 'failed', reasons, videoId);
          else this.fail('extractor', msg, reasons); // opaque: bridge timeout or session creation failure
          const first = reasons[0];
          this.record({ at: this.now(), source: 'device', ok: false, latencyMs: this.now() - t0, reason: first?.reason ?? 'unknown', detail: reasons.map((r) => `${r.source}:${r.reason}`).join(' '), kind });
        }
      }
    }

    if (this.o.server && this.o.serverConfigured() && !this.breaker.isOpen(SERVER)) {
      const t0 = this.now();
      try {
        const s = await this.o.server.resolve(videoId, { fresh: opts?.fresh });
        this.breaker.success(SERVER);
        log('resolver', `${videoId} via server (device failed: ${reasons.map((r) => `${r.source}:${r.reason}`).join(' ') || 'skipped'})`);
        this.record({ at: this.now(), source: 'server', ok: true, latencyMs: this.now() - t0, kind });
        return { ...s, source: 'server' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.breaker.failure(SERVER);
        const reason = classifyFailure(msg) === 'unknown' ? 'server' : classifyFailure(msg);
        reasons.push({ source: SERVER, reason, detail: msg });
        logWarn('resolver', `server failed ${videoId}: ${reason}: ${msg}`);
        this.record({ at: this.now(), source: 'server', ok: false, latencyMs: this.now() - t0, reason, detail: msg.slice(0, 200), kind });
      }
    }

    const summary = reasons.map((r) => `${r.source}:${r.reason}`).join(' ');
    const cls = summarizeClass(reasons);
    throw new ResolveError(`Could not resolve ${videoId} (${summary || 'no source available'})`, reasons, cls, cls === 'RateLimited' ? this.cooldown.remainingMs() || undefined : undefined);
  }

  private fail(client: string, detail: string, reasons: Reason[], videoId?: string): void {
    const reason = classifyFailure(detail);
    const cls = classifyPlayability(detail);
    if (cls === 'RateLimited') {
      this.cooldown.trip();
      log('resolver', `rate limited (${client}); on-device resolves paused for ${Math.ceil(this.cooldown.remainingMs() / 60_000)} min`);
    }
    // No connection says nothing about the client or the video: excluding or tripping the breaker here would leave every
    // client blocked for minutes after the phone comes back online (videos and songs fail until the app restarts).
    const offline = reason === 'network';
    if (videoId && client !== 'extractor' && !offline) {
      this.exclusions.exclude(videoId, client);
      log('resolver', `client ${client} excluded for ${videoId.replace(/^[vm]:/, '')} for 5 min (${reason})`);
    }
    // A video-specific refusal (age gate, private, no such format) or a network-wide rate limit says nothing about the client's health.
    if (!offline && reason !== 'playability' && reason !== 'no-format' && reason !== 'rate-limited' && !isVideoSpecific(cls)) this.breaker.failure(client);
    reasons.push({ source: client, reason, detail: detail.slice(0, 160), cls });
    logWarn('resolver', `client ${client} failed: ${reason}: ${detail.slice(0, 160)}`);
  }
}
