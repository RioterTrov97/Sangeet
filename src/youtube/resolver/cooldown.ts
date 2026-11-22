/**
 * "Try again later" cool-down: when YouTube rate-limits this network, on-device resolves stop for 15 minutes; if it happens again
 * right after the cool-down, 30, then 60 minutes (the cap). Any successful resolve starts over.
 */
export class RateLimitCooldown {
  private until = 0;
  private level = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly baseMs = 15 * 60_000,
    private readonly maxMs = 60 * 60_000,
  ) {}

  /** Records a rate-limit response. While a cool-down is already running it is not extended. */
  trip(): void {
    if (this.active()) return;
    this.level++;
    this.until = this.now() + Math.min(this.baseMs * 2 ** (this.level - 1), this.maxMs);
  }

  active(): boolean {
    return this.now() < this.until;
  }

  remainingMs(): number {
    return Math.max(0, this.until - this.now());
  }

  success(): void {
    this.until = 0;
    this.level = 0;
  }
}
