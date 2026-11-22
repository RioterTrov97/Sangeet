import type { ResolvedStream } from './types';

/** In-memory cache keyed by videoId that honours `expiresAt` (with a safety margin). */
export class StreamCache {
  private entries = new Map<string, ResolvedStream>();
  private generations = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly marginMs = 60_000,
  ) {}

  get(videoId: string): ResolvedStream | undefined {
    const hit = this.entries.get(videoId);
    if (!hit) return undefined;
    if (hit.expiresAt - this.marginMs <= this.now()) {
      this.entries.delete(videoId);
      return undefined;
    }
    return hit;
  }

  /** Starts a resolve of `videoId`: returns its generation. A newer start makes every older one stale. */
  begin(videoId: string): number {
    const g = (this.generations.get(videoId) ?? 0) + 1;
    this.generations.set(videoId, g);
    return g;
  }

  /** Stores `stream`. With a generation (from `begin`) the write is dropped when a newer resolve has started since: a slow resolve must not overwrite a newer one. */
  set(videoId: string, stream: ResolvedStream, generation?: number): boolean {
    if (generation !== undefined && generation < (this.generations.get(videoId) ?? 0)) return false;
    this.entries.set(videoId, stream);
    return true;
  }

  delete(videoId: string): void {
    this.entries.delete(videoId);
  }

  get size(): number {
    return this.entries.size;
  }
}
