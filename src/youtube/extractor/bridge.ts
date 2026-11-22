import { log } from '../../util/log';
import type { BridgeRequest, PageMessage } from './protocol';

export type BridgeTransport = {
  /** Deliver a JSON string to the page. */
  post(message: string): void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Promise-based request/response bridge over a message transport (the WebView).
 * Requests carry an id and time out; a response with the matching id settles them.
 */
export class ExtractorBridge {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private transport?: BridgeTransport;
  private readyWaiters: (() => void)[] = [];
  private isReady = false;

  constructor(private readonly onLog: (message: string) => void = () => {}) {}

  attach(transport: BridgeTransport | undefined): void {
    this.transport = transport;
  }

  /** Resolves once the page has announced it is ready. */
  whenReady(): Promise<void> {
    if (this.isReady) return Promise.resolve();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  request<T>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      if (!this.transport) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Bridge has no transport'));
        return;
      }
      const req: BridgeRequest = { id, method, params };
      this.transport.post(JSON.stringify(req));
    });
  }

  /** Feed a raw message string coming from the page. */
  handleMessage(raw: string): void {
    let msg: PageMessage;
    try {
      msg = JSON.parse(raw) as PageMessage;
    } catch {
      return;
    }
    if (msg.type === 'log') {
      this.onLog(msg.message);
    } else if (msg.type === 'ready') {
      this.isReady = true;
      this.readyWaiters.splice(0).forEach((w) => w());
    } else if (msg.type === 'response') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    }
  }

  /** Reject everything in flight (e.g. the WebView reloaded). */
  reset(reason = 'Bridge reset'): void {
    this.isReady = false;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

export const extractorBridge = new ExtractorBridge((m) => log('extractor', m));
