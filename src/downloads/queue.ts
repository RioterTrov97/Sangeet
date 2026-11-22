/**
 * Download queue state machine, pure of any I/O so it is unit-testable: a `runner` does the actual transfer.
 * 3 concurrent jobs, up to 3 attempts per job with exponential backoff, then a permanent `failed` state until the
 * user taps Retry. A `gate` (Wi-Fi only / offline) pauses starting new jobs without failing queued ones.
 */
export type JobState = 'queued' | 'downloading' | 'done' | 'failed';

export type Job = { id: string; state: JobState; attempts: number; error?: string; bytes: number; total: number };

export type RunResult = { bytes: number };
export type Runner = (id: string, onProgress: (bytes: number, total: number) => void) => Promise<RunResult>;

export type QueueOptions = {
  runner: Runner;
  /** Called on every job change (persist it). */
  onChange: (job: Job) => void;
  /** Called on every progress tick (not persisted; throttle in the UI layer). */
  onProgress?: (job: Job) => void;
  concurrency?: number;
  maxAttempts?: number;
  /** ms before attempt n+1 (n = attempts so far). */
  backoff?: (attempts: number) => number;
  /** Returns an error string to hold new jobs back (they stay queued), or undefined to proceed. */
  gate?: () => string | undefined;
  setTimer?: (fn: () => void, ms: number) => unknown;
};

export class DownloadQueue {
  readonly jobs = new Map<string, Job>();
  private running = 0;
  private retryAt = new Map<string, number>();
  private timers = new Set<unknown>();
  private o: Required<Omit<QueueOptions, 'runner' | 'onChange' | 'gate' | 'onProgress'>> & Pick<QueueOptions, 'runner' | 'onChange' | 'gate' | 'onProgress'>;

  constructor(o: QueueOptions) {
    this.o = { concurrency: 3, maxAttempts: 3, backoff: (n) => 2000 * 2 ** (n - 1), setTimer: (fn, ms) => setTimeout(fn, ms), ...o };
  }

  private set(job: Job) {
    this.jobs.set(job.id, job);
    this.o.onChange(job);
  }

  /** Adds (or revives a failed) job. Done and in-flight jobs are left alone. */
  enqueue(id: string, total = 0): void {
    const cur = this.jobs.get(id);
    if (cur && (cur.state === 'done' || cur.state === 'downloading' || cur.state === 'queued')) return;
    this.set({ id, state: 'queued', attempts: 0, bytes: 0, total });
    this.pump();
  }

  /** Restores a persisted job (e.g. interrupted by an app kill) without resetting its progress. */
  restore(job: Job): void {
    this.jobs.set(job.id, job);
    if (job.state === 'queued') this.pump();
  }

  retry(id: string): void {
    const j = this.jobs.get(id);
    if (j?.state === 'failed') this.enqueue(id, j.total);
  }

  remove(id: string): void {
    this.jobs.delete(id);
    this.retryAt.delete(id);
  }

  pump(): void {
    const now = Date.now();
    for (const job of [...this.jobs.values()]) {
      if (this.running >= this.o.concurrency) return;
      if (job.state !== 'queued') continue;
      if ((this.retryAt.get(job.id) ?? 0) > now) continue;
      if (this.o.gate?.()) continue;
      void this.start(job);
    }
  }

  private async start(job: Job) {
    this.running++;
    this.retryAt.delete(job.id);
    let cur: Job = { ...job, state: 'downloading', attempts: job.attempts + 1, error: undefined };
    this.set(cur);
    try {
      const r = await this.o.runner(job.id, (bytes, total) => {
        if (this.jobs.get(job.id)?.state !== 'downloading') return;
        cur = { ...cur, bytes, total: total || cur.total };
        this.jobs.set(job.id, cur); // progress is not persisted per tick
        this.o.onProgress?.(cur);
      });
      if (!this.jobs.has(job.id)) return; // removed while running
      this.set({ ...cur, state: 'done', bytes: r.bytes, total: r.bytes, error: undefined });
    } catch (e) {
      if (!this.jobs.has(job.id)) return;
      const error = e instanceof Error ? e.message : String(e);
      if (cur.attempts >= this.o.maxAttempts) this.set({ ...cur, state: 'failed', error });
      else {
        const wait = this.o.backoff(cur.attempts);
        this.set({ ...cur, state: 'queued', error });
        this.retryAt.set(job.id, Date.now() + wait);
        const t = this.o.setTimer(() => {
          this.timers.delete(t);
          this.pump();
        }, wait);
        this.timers.add(t);
      }
    } finally {
      this.running--;
      this.pump();
    }
  }
}
