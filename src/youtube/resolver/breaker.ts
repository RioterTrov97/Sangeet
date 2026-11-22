/** Per-source circuit breaker: `threshold` consecutive failures open it for `cooldownMs`; any success closes it. */
export class CircuitBreaker {
  private state = new Map<string, { fails: number; openUntil: number }>();

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  isOpen(name: string): boolean {
    const s = this.state.get(name);
    if (!s || s.openUntil === 0) return false;
    if (this.now() >= s.openUntil) {
      // Half-open: allow one probe; a single further failure re-opens it.
      this.state.set(name, { fails: this.threshold - 1, openUntil: 0 });
      return false;
    }
    return true;
  }

  success(name: string): void {
    this.state.delete(name);
  }

  failure(name: string): void {
    const s = this.state.get(name) ?? { fails: 0, openUntil: 0 };
    const fails = s.fails + 1;
    this.state.set(name, { fails, openUntil: fails >= this.threshold ? this.now() + this.cooldownMs : 0 });
  }

  /** Open breakers and when they close (for the diagnostics screen). */
  snapshot(): { name: string; fails: number; openUntil: number }[] {
    return [...this.state.entries()].map(([name, v]) => ({ name, ...v }));
  }
}
