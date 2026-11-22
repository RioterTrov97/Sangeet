/** A client that failed for a video (extraction, playability, or a URL that did not serve the whole file) is skipped for this long. */
export const CLIENT_EXCLUDE_MS = 5 * 60_000;

/** Per-video client exclusions with a TTL (Metrolist's STREAM_CLIENT_FAILURE_TTL_MS pattern). */
export class ClientExclusions {
  private until = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private key = (videoId: string, client: string) => `${videoId.replace(/^[vm]:/, '')}|${client}`;

  exclude(videoId: string, client: string): void {
    if (this.until.size > 500) this.prune();
    this.until.set(this.key(videoId, client), this.now() + CLIENT_EXCLUDE_MS);
  }

  isExcluded(videoId: string, client: string): boolean {
    const k = this.key(videoId, client);
    const t = this.until.get(k);
    if (t === undefined) return false;
    if (this.now() >= t) {
      this.until.delete(k);
      return false;
    }
    return true;
  }

  private prune(): void {
    const n = this.now();
    for (const [k, t] of this.until) if (t <= n) this.until.delete(k);
  }
}
